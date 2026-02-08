//! Device pairing module
//!
//! Implements the worker side of the device-pairing protocol:
//! 1. Generate (or load) ML-DSA-65 device keypair
//! 2. POST /pairing/start → receive pairingId, code, verification code
//! 3. Display QR + short code + verification code in terminal
//! 4. Poll /pairing/:id/status until APPROVED (or timeout)
//! 5. Sign the challenge with device key
//! 6. POST /pairing/complete → receive deviceId + accountId
//! 7. Persist identity.json

use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use pqcrypto_dilithium::dilithium3;
use pqcrypto_traits::sign::{DetachedSignature, PublicKey, SecretKey};
use serde::{Deserialize, Serialize};
use tokio::time::{sleep, Duration};
use tracing::{debug, info, warn};

// ============================================================================
// Data types
// ============================================================================

/// Persisted device identity (saved after successful pairing)
#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceIdentity {
    pub device_id: String,
    pub account_id: String,
    pub public_key_hex: String,
    pub linked_at: String,
}

/// Server response for POST /pairing/start
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairingStartResponse {
    success: bool,
    pairing_id: String,
    pairing_code: String,
    verification_code: String,
    expires_at: String,
}

/// Server response for GET /pairing/:id/status
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairingStatusResponse {
    success: bool,
    status: String,
    challenge: Option<String>,
    account_id: Option<String>,
}

/// Server response for POST /pairing/complete
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairingCompleteResponse {
    success: bool,
    device_id: String,
    account_id: String,
}

// ============================================================================
// Key management
// ============================================================================

/// Directory for worker identity data
fn identity_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("Cannot determine home directory"))?;
    Ok(home.join(".ai4all").join("worker"))
}

/// Load or generate a device keypair. Returns (public_key_bytes, secret_key_bytes).
fn load_or_generate_keypair(force: bool) -> Result<(Vec<u8>, Vec<u8>)> {
    let dir = identity_dir()?;
    let pk_path = dir.join("device_public.key");
    let sk_path = dir.join("device_secret.key");

    if !force && pk_path.exists() && sk_path.exists() {
        info!("Loading existing device keypair");
        let pk_bytes = std::fs::read(&pk_path)
            .with_context(|| format!("Failed to read {}", pk_path.display()))?;
        let sk_bytes = std::fs::read(&sk_path)
            .with_context(|| format!("Failed to read {}", sk_path.display()))?;
        return Ok((pk_bytes, sk_bytes));
    }

    info!("Generating new ML-DSA-65 device keypair");
    let (pk, sk) = dilithium3::keypair();
    let pk_bytes = pk.as_bytes().to_vec();
    let sk_bytes = sk.as_bytes().to_vec();

    // Persist
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("Failed to create {}", dir.display()))?;
    std::fs::write(&pk_path, &pk_bytes)
        .with_context(|| format!("Failed to write {}", pk_path.display()))?;
    std::fs::write(&sk_path, &sk_bytes)
        .with_context(|| format!("Failed to write {}", sk_path.display()))?;

    info!(
        path = %dir.display(),
        pk_size = pk_bytes.len(),
        "Device keypair generated and saved"
    );

    Ok((pk_bytes, sk_bytes))
}

/// Sign a message with the device secret key
fn sign_message(message: &[u8], sk_bytes: &[u8]) -> Result<Vec<u8>> {
    let sk = dilithium3::SecretKey::from_bytes(sk_bytes)
        .map_err(|_| anyhow!("Invalid secret key bytes"))?;
    let sig = dilithium3::detached_sign(message, &sk);
    Ok(sig.as_bytes().to_vec())
}

/// Load the saved identity (post-pairing)
pub fn load_identity() -> Result<Option<DeviceIdentity>> {
    let path = identity_dir()?.join("identity.json");
    if !path.exists() {
        return Ok(None);
    }
    let data = std::fs::read_to_string(&path)
        .with_context(|| format!("Failed to read {}", path.display()))?;
    let identity: DeviceIdentity = serde_json::from_str(&data)?;
    Ok(Some(identity))
}

/// Save identity after successful pairing
fn save_identity(identity: &DeviceIdentity) -> Result<()> {
    let dir = identity_dir()?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("identity.json");
    let data = serde_json::to_string_pretty(identity)?;
    std::fs::write(&path, data)
        .with_context(|| format!("Failed to write {}", path.display()))?;
    info!(path = %path.display(), "Identity saved");
    Ok(())
}

// ============================================================================
// QR display
// ============================================================================

fn display_qr_and_code(pairing_id: &str, pairing_code: &str, verification_code: &str, api_url: &str, expires_at: &str) {
    // Build minimal QR payload
    let qr_payload = serde_json::json!({
        "v": 1,
        "t": "pair",
        "pairingId": pairing_id,
        "api": api_url,
    });
    let qr_string = qr_payload.to_string();

    println!();
    println!("=== Device Pairing ===");
    println!();

    // Render QR code as ASCII art
    match qrcode::QrCode::new(qr_string.as_bytes()) {
        Ok(code) => {
            let image = code
                .render::<char>()
                .quiet_zone(false)
                .module_dimensions(2, 1)
                .build();
            println!("{}", image);
        }
        Err(e) => {
            warn!(error = %e, "Failed to generate QR code");
            println!("  (QR code generation failed)");
        }
    }

    println!();
    println!("  Short code:        {}", pairing_code);
    println!("  Verification code: {}", verification_code);
    println!("  Expires at:        {}", expires_at);
    println!();
    println!("Open the AI4All wallet app on your phone:");
    println!("  1. Go to Settings > Link Worker");
    println!("  2. Scan the QR code above, or enter the short code");
    println!("  3. Verify the 4-digit code matches: {}", verification_code);
    println!("  4. Tap Approve");
    println!();
    println!("Waiting for approval...");
}

// ============================================================================
// Pairing flow
// ============================================================================

/// Run the full pairing flow
pub async fn run_pairing(api_url: &str, name: &str, force: bool) -> Result<()> {
    let client = reqwest::Client::new();

    // Step 1: Load or generate device keypair
    let (pk_bytes, sk_bytes) = load_or_generate_keypair(force)?;
    let pk_hex = hex::encode(&pk_bytes);

    info!(pk_len = pk_bytes.len(), "Device public key ready");

    // Step 2: POST /pairing/start
    let start_url = format!("{}/pairing/start", api_url.trim_end_matches('/'));
    let start_body = serde_json::json!({
        "devicePublicKey": pk_hex,
        "deviceName": name,
        "capabilities": {
            "cpuCores": num_cpus::get(),
            "os": std::env::consts::OS,
        },
    });

    let resp = client
        .post(&start_url)
        .json(&start_body)
        .send()
        .await
        .context("Failed to connect to API server")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        bail!("POST /pairing/start failed ({}): {}", status, body);
    }

    let start: PairingStartResponse = resp.json().await.context("Invalid start response")?;
    if !start.success {
        bail!("Pairing start failed");
    }

    info!(
        pairing_id = %start.pairing_id,
        pairing_code = %start.pairing_code,
        "Pairing session created"
    );

    // Step 3: Display QR + codes
    display_qr_and_code(
        &start.pairing_id,
        &start.pairing_code,
        &start.verification_code,
        api_url,
        &start.expires_at,
    );

    // Step 4: Poll for approval (every 2s, up to 5 min)
    let status_url = format!(
        "{}/pairing/{}/status",
        api_url.trim_end_matches('/'),
        start.pairing_id
    );
    let max_polls = 150; // 5 min / 2s
    let mut challenge = String::new();
    let mut account_id = String::new();

    for i in 0..max_polls {
        sleep(Duration::from_secs(2)).await;

        let resp = client.get(&status_url).send().await;
        let resp = match resp {
            Ok(r) => r,
            Err(e) => {
                debug!(error = %e, attempt = i, "Poll failed, retrying");
                continue;
            }
        };

        if !resp.status().is_success() {
            debug!(status = %resp.status(), "Non-success status during poll");
            continue;
        }

        let status: PairingStatusResponse = match resp.json().await {
            Ok(s) => s,
            Err(e) => {
                debug!(error = %e, "Failed to parse status response");
                continue;
            }
        };

        match status.status.as_str() {
            "PENDING" => {
                if i % 15 == 14 {
                    println!("  Still waiting... ({}/150)", i + 1);
                }
            }
            "APPROVED" => {
                challenge = status.challenge.ok_or_else(|| anyhow!("APPROVED but no challenge"))?;
                account_id = status.account_id.ok_or_else(|| anyhow!("APPROVED but no accountId"))?;
                println!();
                println!("  Approved by wallet: {}", &account_id[..12.min(account_id.len())]);
                break;
            }
            "EXPIRED" => {
                bail!("Pairing expired. Please try again.");
            }
            other => {
                bail!("Unexpected pairing status: {}", other);
            }
        }
    }

    if challenge.is_empty() {
        bail!("Timed out waiting for approval (5 minutes)");
    }

    // Step 5: Sign the challenge with device key
    let challenge_bytes = hex::decode(&challenge).context("Invalid challenge hex")?;
    let sig_bytes = sign_message(&challenge_bytes, &sk_bytes)?;
    let sig_hex = hex::encode(&sig_bytes);

    info!("Challenge signed, completing pairing");

    // Step 6: POST /pairing/complete
    let complete_url = format!("{}/pairing/complete", api_url.trim_end_matches('/'));
    let complete_body = serde_json::json!({
        "pairingId": start.pairing_id,
        "signature": sig_hex,
    });

    let resp = client
        .post(&complete_url)
        .json(&complete_body)
        .send()
        .await
        .context("Failed to send complete request")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        bail!("POST /pairing/complete failed ({}): {}", status, body);
    }

    let complete: PairingCompleteResponse = resp.json().await.context("Invalid complete response")?;
    if !complete.success {
        bail!("Pairing completion failed");
    }

    // Step 7: Save identity
    let identity = DeviceIdentity {
        device_id: complete.device_id.clone(),
        account_id: complete.account_id.clone(),
        public_key_hex: pk_hex,
        linked_at: chrono::Utc::now().to_rfc3339(),
    };
    save_identity(&identity)?;

    println!();
    println!("=== Pairing Complete ===");
    println!("  Device ID: {}", complete.device_id);
    println!("  Account:   {}", complete.account_id);
    println!();
    println!("This worker will now earn rewards credited to your wallet.");

    Ok(())
}
