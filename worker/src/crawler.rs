//! Background web crawler service
//!
//! `CrawlerService` runs autonomously in the background, crawling seed URLs
//! from the config and submitting discovered pages to the coordinator via
//! `POST /data/crawled`.  It signs each submission with the worker's ML-DSA-65
//! secret key (same pattern as peer registration).

use std::collections::HashSet;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::backend::{CrawlerBackend, InferenceBackend};
use crate::config::{CrawlerSettings, OpenAiSettings};
use crate::types::WebCrawlInput;

// ─────────────────────────────────────────────────────────────────
// Wire types for the coordinator /data/crawled endpoint
// ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CrawledPagePayload {
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    embedding: Option<Vec<f32>>,
    fetched_at: String,
    content_hash: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DataIngestRequest {
    account_id: String,
    timestamp: String,
    signature: String,
    pages: Vec<CrawledPagePayload>,
}

#[derive(Debug, Deserialize)]
struct DataIngestResponse {
    accepted: u32,
    reward: Option<String>,
}

// ─────────────────────────────────────────────────────────────────
// CrawlerService
// ─────────────────────────────────────────────────────────────────

/// Background service that crawls seed URLs and submits results to the coordinator.
pub struct CrawlerService {
    crawler_config: CrawlerSettings,
    openai_config: OpenAiSettings,
}

impl CrawlerService {
    pub fn new(crawler_config: CrawlerSettings, openai_config: OpenAiSettings) -> Self {
        Self { crawler_config, openai_config }
    }

    /// Spawn a background tokio task.  Returns immediately.
    ///
    /// The task loops every 5 minutes:
    /// 1. For each seed URL, run a crawl via `CrawlerBackend`.
    /// 2. Sign the payload with the ML-DSA-65 secret key.
    /// 3. POST to `{coordinator_http}/data/crawled`.
    pub fn start(self, coordinator_http: String, account_id: String, secret_key: String) {
        tokio::spawn(async move {
            self.run(coordinator_http, account_id, secret_key).await;
        });
    }

    async fn run(&self, coordinator_http: String, account_id: String, secret_key: String) {
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default();

        let backend = CrawlerBackend::new(&self.crawler_config, &self.openai_config);
        let mut seen_urls: HashSet<String> = HashSet::new();

        let sk_bytes = match hex::decode(&secret_key) {
            Ok(b) => b,
            Err(e) => {
                warn!(error = %e, "CrawlerService: invalid secret_key hex");
                return;
            }
        };

        info!(seeds = self.crawler_config.seeds.len(), "CrawlerService started");

        loop {
            for seed in &self.crawler_config.seeds {
                if seen_urls.contains(seed) {
                    continue;
                }

                let input = WebCrawlInput {
                    url: seed.clone(),
                    max_depth: self.crawler_config.depth,
                    max_pages: self.crawler_config.max_pages,
                    generate_embeddings: self.crawler_config.generate_embeddings,
                    allowed_domains: vec![],
                };

                let output = match backend.web_crawl(input).await {
                    Ok(o) => o,
                    Err(e) => {
                        warn!(seed = %seed, error = %e, "Crawl failed");
                        continue;
                    }
                };

                if output.pages.is_empty() {
                    continue;
                }

                for page in &output.pages {
                    seen_urls.insert(page.url.clone());
                }

                let pages: Vec<CrawledPagePayload> = output
                    .pages
                    .into_iter()
                    .map(|p| CrawledPagePayload {
                        url: p.url,
                        title: p.title,
                        text: p.text,
                        embedding: p.embedding,
                        fetched_at: p.fetched_at,
                        content_hash: p.content_hash,
                    })
                    .collect();

                // Sign: "AI4ALL:v1:{accountId}:{timestamp}"
                let timestamp = chrono::Utc::now()
                    .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                let message = format!("AI4ALL:v1:{}:{}", account_id, timestamp);

                let maybe_sig: Option<String> = (|| {
                    use pqcrypto_dilithium::dilithium3;
                    use pqcrypto_traits::sign::{DetachedSignature, SecretKey as PqSecretKey};
                    let sk = dilithium3::SecretKey::from_bytes(&sk_bytes).ok()?;
                    let sig = dilithium3::detached_sign(message.as_bytes(), &sk);
                    Some(hex::encode(sig.as_bytes()))
                })();

                let sig_hex = match maybe_sig {
                    Some(s) => s,
                    None => {
                        warn!("CrawlerService: failed to sign data ingest request");
                        continue;
                    }
                };

                let body = DataIngestRequest {
                    account_id: account_id.clone(),
                    timestamp,
                    signature: sig_hex,
                    pages,
                };

                let url = format!("{}/data/crawled", coordinator_http);
                match http_client.post(&url).json(&body).send().await {
                    Ok(resp) if resp.status().is_success() => {
                        if let Ok(result) = resp.json::<DataIngestResponse>().await {
                            info!(
                                seed = %seed,
                                accepted = result.accepted,
                                reward = result.reward.as_deref().unwrap_or("0"),
                                "Crawl data submitted"
                            );
                        }
                    }
                    Ok(resp) => {
                        let status = resp.status();
                        let text = resp.text().await.unwrap_or_default();
                        warn!(seed = %seed, status = %status, body = %text, "Data ingest rejected");
                    }
                    Err(e) => {
                        warn!(seed = %seed, error = %e, "Could not reach coordinator for data ingest");
                    }
                }
            }

            // Wait 5 minutes before the next run
            tokio::time::sleep(Duration::from_secs(300)).await;
        }
    }
}
