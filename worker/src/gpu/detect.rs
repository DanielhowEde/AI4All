//! GPU detection via Vulkan
//!
//! Uses the Vulkan API (via ash crate) to enumerate GPUs
//! and gather hardware information.

use crate::error::{Error, Result};

use super::{GpuApi, GpuInfo, GpuVendor};

// ─────────────────────────────────────────────────────────────────
// Vulkan-based GPU Detection (when feature enabled)
// ─────────────────────────────────────────────────────────────────

/// Detect all GPUs in the system
#[cfg(feature = "gpu")]
pub fn detect_gpus() -> Result<Vec<GpuInfo>> {
    use ash::vk;
    use tracing::{debug, info, warn};

    info!("Detecting GPUs via Vulkan...");

    // Create Vulkan entry point
    let entry = unsafe {
        ash::Entry::load()
            .map_err(|e| Error::GpuDetectionFailed {
                message: format!("Failed to load Vulkan: {}", e),
            })?
    };

    // Check Vulkan version
    let api_version = match entry.try_enumerate_instance_version() {
        Ok(Some(version)) => version,
        Ok(None) => vk::API_VERSION_1_0,
        Err(e) => {
            warn!("Failed to get Vulkan version: {:?}", e);
            vk::API_VERSION_1_0
        }
    };

    debug!(
        "Vulkan API version: {}.{}.{}",
        vk::api_version_major(api_version),
        vk::api_version_minor(api_version),
        vk::api_version_patch(api_version)
    );

    // Create Vulkan instance
    let app_info = vk::ApplicationInfo::builder()
        .application_name(c"AI4All Worker")
        .application_version(vk::make_api_version(0, 0, 1, 0))
        .engine_name(c"AI4All")
        .engine_version(vk::make_api_version(0, 0, 1, 0))
        .api_version(api_version);

    let create_info = vk::InstanceCreateInfo::builder()
        .application_info(&app_info);

    let instance = unsafe {
        entry.create_instance(&create_info, None)
            .map_err(|e| Error::GpuDetectionFailed {
                message: format!("Failed to create Vulkan instance: {:?}", e),
            })?
    };

    // Enumerate physical devices
    let physical_devices = unsafe {
        instance.enumerate_physical_devices()
            .map_err(|e| Error::GpuDetectionFailed {
                message: format!("Failed to enumerate devices: {:?}", e),
            })?
    };

    info!("Found {} physical device(s)", physical_devices.len());

    let mut gpus = Vec::new();

    for (idx, device) in physical_devices.iter().enumerate() {
        // Get device properties
        let properties = unsafe { instance.get_physical_device_properties(*device) };

        // Get memory properties
        let memory_props = unsafe { instance.get_physical_device_memory_properties(*device) };

        // Calculate total VRAM (device-local memory)
        let total_memory_mb = calculate_device_memory(&memory_props);

        // Get device name
        let name = unsafe {
            std::ffi::CStr::from_ptr(properties.device_name.as_ptr())
                .to_string_lossy()
                .to_string()
        };

        // Get vendor
        let vendor = GpuVendor::from_vendor_id(properties.vendor_id);

        // Determine if discrete
        let is_discrete = properties.device_type == vk::PhysicalDeviceType::DISCRETE_GPU;

        // Build API support list
        let mut api_support = vec![GpuApi::Vulkan];

        // Add vendor-specific APIs
        match vendor {
            GpuVendor::Nvidia => api_support.push(GpuApi::Cuda),
            GpuVendor::Amd => api_support.push(GpuApi::Rocm),
            GpuVendor::Apple => api_support.push(GpuApi::Metal),
            _ => {}
        }

        // Format Vulkan version
        let vulkan_version = Some(format!(
            "{}.{}.{}",
            vk::api_version_major(properties.api_version),
            vk::api_version_minor(properties.api_version),
            vk::api_version_patch(properties.api_version)
        ));

        // Format driver version (vendor-specific)
        let driver_version = format_driver_version(properties.driver_version, vendor);

        // Check compute capability (queue families)
        let compute_capable = check_compute_capable(&instance, *device);

        let gpu_info = GpuInfo {
            id: idx as u32,
            name,
            vendor,
            vendor_id: properties.vendor_id,
            device_id: properties.device_id,
            total_memory_mb,
            driver_version,
            api_support,
            vulkan_version,
            is_discrete,
            compute_capable,
        };

        debug!(
            "GPU {}: {} ({}) - {}MB VRAM",
            idx, gpu_info.name, gpu_info.vendor, gpu_info.total_memory_mb
        );

        gpus.push(gpu_info);
    }

    // Cleanup Vulkan instance
    unsafe {
        instance.destroy_instance(None);
    }

    info!("Detected {} GPU(s)", gpus.len());
    Ok(gpus)
}

/// Calculate total device-local memory in MB
#[cfg(feature = "gpu")]
fn calculate_device_memory(memory_props: &ash::vk::PhysicalDeviceMemoryProperties) -> u64 {
    use ash::vk;

    let mut total_bytes: u64 = 0;

    for i in 0..memory_props.memory_heap_count as usize {
        let heap = memory_props.memory_heaps[i];
        // Only count device-local heaps (VRAM)
        if heap.flags.contains(vk::MemoryHeapFlags::DEVICE_LOCAL) {
            total_bytes += heap.size;
        }
    }

    // Convert to MB
    total_bytes / (1024 * 1024)
}

/// Format driver version (vendor-specific encoding)
#[cfg(feature = "gpu")]
fn format_driver_version(version: u32, vendor: GpuVendor) -> String {
    match vendor {
        GpuVendor::Nvidia => {
            // NVIDIA: (major << 22) | (minor << 14) | patch
            let major = (version >> 22) & 0x3FF;
            let minor = (version >> 14) & 0xFF;
            let patch = version & 0x3FFF;
            format!("{}.{}.{}", major, minor, patch)
        }
        _ => {
            // Standard Vulkan versioning
            format!(
                "{}.{}.{}",
                ash::vk::api_version_major(version),
                ash::vk::api_version_minor(version),
                ash::vk::api_version_patch(version)
            )
        }
    }
}

/// Check if device supports compute operations
#[cfg(feature = "gpu")]
fn check_compute_capable(instance: &ash::Instance, device: ash::vk::PhysicalDevice) -> bool {
    use ash::vk;

    let queue_families = unsafe {
        instance.get_physical_device_queue_family_properties(device)
    };

    queue_families.iter().any(|qf| qf.queue_flags.contains(vk::QueueFlags::COMPUTE))
}

// ─────────────────────────────────────────────────────────────────
// Fallback Detection (when feature disabled)
// ─────────────────────────────────────────────────────────────────

/// Detect GPUs (stub when gpu feature is disabled)
#[cfg(not(feature = "gpu"))]
pub fn detect_gpus() -> Result<Vec<GpuInfo>> {
    use tracing::warn;

    warn!("GPU detection disabled: compile with --features gpu");
    Ok(vec![])
}

// ─────────────────────────────────────────────────────────────────
// Platform-specific Helpers
// ─────────────────────────────────────────────────────────────────

/// Check if Vulkan is available on the system
pub fn is_vulkan_available() -> bool {
    #[cfg(feature = "gpu")]
    {
        unsafe { ash::Entry::load().is_ok() }
    }

    #[cfg(not(feature = "gpu"))]
    {
        false
    }
}

/// Get a brief system GPU summary (without full detection)
pub fn quick_gpu_check() -> String {
    #[cfg(feature = "gpu")]
    {
        match detect_gpus() {
            Ok(gpus) if gpus.is_empty() => "No GPUs detected".to_string(),
            Ok(gpus) => {
                let primary = super::select_best_gpu(&gpus);
                match primary {
                    Some(gpu) => gpu.summary(),
                    None => format!("{} GPU(s) detected (none compute-capable)", gpus.len()),
                }
            }
            Err(e) => format!("GPU detection failed: {}", e),
        }
    }

    #[cfg(not(feature = "gpu"))]
    {
        "GPU detection not compiled (use --features gpu)".to_string()
    }
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vulkan_availability() {
        // This will pass regardless of whether Vulkan is installed
        // It just checks that the function doesn't panic
        let _ = is_vulkan_available();
    }

    #[test]
    fn test_quick_gpu_check() {
        // Should return some string, not panic
        let result = quick_gpu_check();
        assert!(!result.is_empty());
    }

    #[test]
    fn test_detect_gpus_no_panic() {
        // Even if no GPUs, should return Ok with empty vec
        // or an error - but not panic
        let _ = detect_gpus();
    }

    #[cfg(feature = "gpu")]
    #[test]
    fn test_driver_version_nvidia() {
        // NVIDIA version encoding: 537.42 -> encoded value
        let encoded = (537 << 22) | (42 << 14);
        let formatted = format_driver_version(encoded, GpuVendor::Nvidia);
        assert!(formatted.starts_with("537.42"));
    }
}
