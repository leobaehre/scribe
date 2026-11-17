The first beta of **Scribe**, a clean, minimal document editor for Mac that saves straight to Word (`.docx`).

Thanks for testing it! This is early software, so keep a copy of anything important you write in it.

## Install

1. Download **`Scribe_0.1.0_universal.dmg`** below. It works on Apple Silicon and Intel Macs (macOS 11 or later).
2. Open it and drag **Scribe** into **Applications**.
3. The first time you open Scribe, macOS will block it, because this beta isn't notarized by Apple. That's expected:
   - Open Scribe once and close the warning.
   - Go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to the message about Scribe.
   - Click **Open** to confirm. From then on it opens normally.

If macOS says the app is "damaged", open Terminal, run this, and try again:

```
xattr -dr com.apple.quarantine /Applications/Scribe.app
```

## What's in it

- **Real pages.** Text flows across A4 pages with margins and page numbers.
- **A Google Docs–style toolbar.** Styles, fonts, font size, bold/italic/underline/strikethrough, text and highlight colors, links, images, alignment, lists, indents and clear formatting.
- **Word files as the native format.** ⌘S saves a normal `.docx` that also opens in Word, Pages and Google Docs. Reopening it in Scribe brings everything back exactly.
- **A Mac menu bar** with the usual shortcuts: ⌘N, ⌘O, ⌘S, ⇧⌘S, ⌘B, ⌘I, ⌘U, ⌘K, and more.

## Please try

- **Write a few pages.** Does text move onto the next page cleanly as you type, delete and paste? Does the cursor stay visible?
- **Format things.** Try every toolbar button, especially font size, colors, lists and indents.
- **Save, quit, reopen.** Is everything exactly as you left it?
- **Open your Scribe file in Word, Pages or Google Docs.** Does it look right? Does Word complain or offer to "repair" it?
- **Open a Word file someone else made.** Did anything important go missing?
- **Add images,** including large ones. Do they fit on the page and survive saving?

## Known limitations

- Word files made in other apps come in without their colors, fonts and font sizes for now. Headings, lists, bold/italic, links, tables and images do come through. Saving over such a file asks first, since things like headers, footers and comments would be lost.
- Images, and single table rows, taller than a page don't split across pages. (Tables do split between rows, and repeat their header row on each page.)
- A heading can end up alone at the bottom of a page.
- In dark mode, black or dark-gray text colors are hard to read on the dark page.
- Mac only for now.

## Feedback

Found a bug, or something felt off? [Open an issue](https://github.com/leobaehre/scribe/issues/new) or just send me a message. Screenshots and the steps to make it happen help a lot.
