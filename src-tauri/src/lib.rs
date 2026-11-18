use tauri::Emitter;

#[cfg(target_os = "macos")]
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};

    // Custom items carry an id that is forwarded to the frontend as a "menu" event.
    let item = |id: &str, label: &str, accel: &str| {
        MenuItem::with_id(app, id, label, true, Some(accel))
    };
    let sep = || PredefinedMenuItem::separator(app);

    // About Scribe: "Version 0.1.0 (83fc47d)", plus "· debug" in debug builds.
    let build = env!("SCRIBE_COMMIT").to_string() + if cfg!(debug_assertions) { " · debug" } else { "" };
    let about = AboutMetadata {
        short_version: Some(app.package_info().version.to_string()),
        version: Some(build),
        ..Default::default()
    };

    let app_menu = Submenu::with_items(
        app,
        "Scribe",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Scribe"), Some(about))?,
            &sep()?,
            &PredefinedMenuItem::services(app, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item("new", "New", "CmdOrCtrl+N")?,
            &item("open", "Open…", "CmdOrCtrl+O")?,
            &sep()?,
            &item("save", "Save", "CmdOrCtrl+S")?,
            &item("saveAs", "Save As…", "CmdOrCtrl+Shift+S")?,
            &sep()?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    // Undo/Redo go to the editor's own history; clipboard items stay native.
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &item("undo", "Undo", "CmdOrCtrl+Z")?,
            &item("redo", "Redo", "CmdOrCtrl+Shift+Z")?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let format_menu = Submenu::with_items(
        app,
        "Format",
        true,
        &[
            &item("bold", "Bold", "CmdOrCtrl+B")?,
            &item("italic", "Italic", "CmdOrCtrl+I")?,
            &item("underline", "Underline", "CmdOrCtrl+U")?,
            &item("strike", "Strikethrough", "CmdOrCtrl+Shift+X")?,
            &item("link", "Link…", "CmdOrCtrl+K")?,
            &sep()?,
            &item("paragraph", "Body Text", "CmdOrCtrl+Alt+0")?,
            &item("h1", "Heading 1", "CmdOrCtrl+Alt+1")?,
            &item("h2", "Heading 2", "CmdOrCtrl+Alt+2")?,
            &item("h3", "Heading 3", "CmdOrCtrl+Alt+3")?,
            &sep()?,
            &item("bulletList", "Bulleted List", "CmdOrCtrl+Shift+8")?,
            &item("orderedList", "Numbered List", "CmdOrCtrl+Shift+7")?,
            &item("blockquote", "Quote", "CmdOrCtrl+Shift+B")?,
            &sep()?,
            &item("alignLeft", "Align Left", "CmdOrCtrl+Shift+L")?,
            &item("alignCenter", "Center", "CmdOrCtrl+Shift+E")?,
            &item("alignRight", "Align Right", "CmdOrCtrl+Shift+R")?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &sep()?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &format_menu, &window_menu])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                let menu = build_menu(app.handle())?;
                app.set_menu(menu)?;
            }
            let _ = app;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("menu", event.id().0.as_str());
        })
        .run(tauri::generate_context!())
        .expect("error while running Scribe");
}
