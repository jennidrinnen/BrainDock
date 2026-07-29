# BrainDock Version 1 Fixed

This version includes:

- Browser voice recording
- Notes and recordings stored in IndexedDB
- Projects and tasks
- Full JSON backup
- Full JSON restore
- iPhone share sheet support for saving backups to iCloud Drive
- GitHub Pages compatibility
- Offline caching
- Visible error reporting

## Backup behavior

Backup exports a complete snapshot of everything currently stored on the device.
Each backup filename includes a date and time, so it does not overwrite earlier backups unless you manually choose the same filename.

## Restore behavior

Restore replaces the current local BrainDock database with the selected backup after confirmation.

## Updating GitHub

Upload and replace these files in the repository root:

- index.html
- app.js
- styles.css
- manifest.json
- sw.js
- README.md

After deployment, reload the site. If an old version remains cached, use a private browser tab once or clear the site's cached website data.
