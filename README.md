# BrainDock with iCloud Drive Backup

This version stores BrainDock data in IndexedDB on the current device and includes manual backup and restore.

## How backup works on iPhone

1. Open BrainDock in Safari.
2. Tap **Backup**.
3. The iOS share sheet opens.
4. Choose **Save to Files**.
5. Select **iCloud Drive**.
6. Create or choose a folder named `BrainDock`.
7. Save the JSON backup file.

## How restore works

1. Tap **Restore**.
2. Pick a BrainDock JSON backup from the Files app.
3. Confirm the replacement of the current local database.

## Storage model

- Working data: IndexedDB on the current browser/device
- Backup: JSON file saved manually to iCloud Drive
- Audio: Included inside the JSON backup as data URLs

## Important notes

- Clearing Safari website data can remove the local IndexedDB database.
- Create backups regularly.
- Large or numerous audio recordings will create large backup files.
- Microphone access requires HTTPS or localhost.
- Automatic background iCloud synchronization is not included. That would require CloudKit and an Apple Developer setup.
