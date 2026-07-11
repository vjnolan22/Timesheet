# TimeSheet

A personal Clock In / Break / Clock Out time tracker. Runs entirely in your browser —
no server, no account, no cloud. Your hours are stored in that browser's local storage
on whichever device you use it from.

## Running it

This is a static web app (plain HTML/CSS/JS) — it must be served over HTTP (not opened
directly as a `file://` page), because the offline service worker requires it.

### macOS / Linux (Python 3 is preinstalled on macOS)

1. Unzip this file.
2. Open Terminal, `cd` into the extracted `TimeSheet` folder.
3. Run:
   ```
   python3 -m http.server 8934
   ```
4. Open `http://localhost:8934` in your browser.

### Windows (with Python installed)

1. Unzip this file.
2. Open Command Prompt / PowerShell, `cd` into the extracted `TimeSheet` folder.
3. Run:
   ```
   python -m http.server 8934
   ```
4. Open `http://localhost:8934` in your browser.

(No Python? Any static file server works — e.g. `npx serve .` if you have Node.js.)

## Using it on your phone

1. Start the server on your computer (steps above) and leave it running.
2. Find your computer's local IP address:
   - macOS: System Settings → Wi-Fi → Details → look for an address like `192.168.x.x`
   - Windows: open Command Prompt, run `ipconfig`, look for "IPv4 Address"
3. Make sure your phone is on the **same Wi-Fi network** as your computer.
4. On your phone's browser, go to `http://<your-computer-IP>:8934` (e.g. `http://192.168.1.42:8934`).
5. **iOS Safari**: tap the Share icon → "Add to Home Screen" to install it like a real app.

Note: this only works while your computer's server is running and both devices are on
the same network. For access from anywhere without a computer running, this would need
to be deployed to a static host (e.g. GitHub Pages) instead — ask if you want that set up.

## Backing up your data

Since there's no backend, your hours live only in that one browser. Use the **⋯** menu
in the top right:
- **Export Backup (.json)** — downloads all your shifts as a file. Do this periodically,
  and especially before switching phones/browsers or clearing site data.
- **Import Backup (.json)** — restores from a previously exported file (replaces all
  current data after confirming).

## Reminder notifications

Tap **Enable Reminder Notifications** in the **⋯** menu to get a notification if you're
still clocked in after 8 hours. On iOS, this works most reliably after adding the app to
your Home Screen (see step 5 above) and granting notification permission when prompted.
