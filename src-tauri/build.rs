use std::process::Command;

/// The git commit the app is built from, e.g. "83fc47d" or "83fc47d-dirty"
/// (uncommitted changes). Shown in Scribe → About Scribe.
fn commit() -> String {
    let git = |args: &[&str]| {
        Command::new("git")
            .args(args)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    };
    match git(&["rev-parse", "--short", "HEAD"]) {
        Some(hash) if !hash.is_empty() => {
            let dirty = git(&["status", "--porcelain"]).is_some_and(|s| !s.is_empty());
            if dirty { format!("{hash}-dirty") } else { hash }
        }
        _ => "unknown".into(),
    }
}

fn main() {
    println!("cargo:rustc-env=SCRIBE_COMMIT={}", commit());
    // Rebuild the label when the checked-out commit or the staged files change.
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/index");
    tauri_build::build()
}
