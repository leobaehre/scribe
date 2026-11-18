# Scribe

A clean, minimal desktop document editor. Write on real pages, format like you would in Google Docs, and save straight to Word (`.docx`).

Built with Tauri 2, React and Tiptap.

> **Beta.** Scribe is early software. Keep a copy of anything important, and please [report problems](../../issues).

## Features

- **Word files as the native format.** Saving writes a normal `.docx` that opens in Word, Pages and Google Docs. Scribe also tucks an exact copy of the document inside the file, so reopening it in Scribe loses nothing.
- **Real pages.** Text flows onto A4 pages with margins and page numbers, splitting paragraphs between lines and tables between rows (repeating the header row) like a word processor.
- **Google Docs–style toolbar.** Styles, fonts, font size, bold/italic/underline/strikethrough, text and highlight colors, links, images, alignment, lists, indentation and clear formatting.
- **Native macOS menu bar** with the usual shortcuts (⌘N, ⌘O, ⌘S, ⇧⌘S, ⌘B, ⌘I, ⌘U, ⌘K, …).

## Install (macOS)

1. Download `Scribe_<version>_universal.dmg` from the [latest release](../../releases). It runs on both Apple Silicon and Intel Macs (macOS 11 or later).
2. Open the `.dmg` and drag **Scribe** into **Applications**.
3. The first time, macOS will block it because the beta isn't notarized by Apple:
   - Open Scribe once and dismiss the warning.
   - Go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to the message about Scribe.
   - Confirm with **Open**. After that it opens normally.

   If macOS says the app is "damaged", run this in Terminal and try again:

       xattr -dr com.apple.quarantine /Applications/Scribe.app

## Working with Word files

| You open… | What happens |
|---|---|
| A `.docx` saved by Scribe | Opens exactly as you left it. |
| A `.docx` from Word or another app (or edited there since) | Imported with its look: fonts, sizes, colors, highlights, alignment, headings, lists, links, images and tables (including merged cells). Headers, footers, comments, footnotes, equations and charts aren't shown, so the first Save asks whether to replace the original. |
| An older `.scribe` file | Opens and keeps saving as `.scribe`. |

## Develop

Prerequisites: Node 20+, Rust (https://rustup.rs), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

    npm install
    npm run tauri dev      # run the app with hot reload
    npm run tauri build    # build an installer for this machine

Universal macOS build (what the releases use):

    rustup target add aarch64-apple-darwin x86_64-apple-darwin
    npm run tauri build -- --target universal-apple-darwin --bundles dmg

Checks:

    npm run build                          # type-check and bundle the frontend
    npm run test:docx-export               # .docx save → Word view → reopen round trip
    npm run test:docx-import               # importing Word files from other apps
    npm run test:docx -- some-file.docx    # how a Word file imports

### Layout

| Path | What's there |
|---|---|
| `src/App.tsx` | Window layout, file commands, menu wiring |
| `src/Toolbar.tsx` | Formatting toolbar |
| `src/lib/pagination.ts` | Splits the document into pages |
| `src/lib/docxFormat.ts` | Writes `.docx` (and reads back Scribe's own) |
| `src/lib/docxImport.ts` | Imports `.docx` from other apps |
| `src/lib/docx.ts` | Fallback importer (mammoth) for unusual files |
| `src/lib/files.ts` | Open/save dialogs |
| `src-tauri/src/lib.rs` | macOS menu bar |

## Credits

Table splitting across pages is adapted from [tiptap-a4-pagination](https://github.com/HuyPhan1232203/Text-editor-react/tree/main/packages/tiptap-a4-pagination) by Phan Nhật Huy (MIT).

## License

[MIT](LICENSE) © 2026 Leo Bähre
