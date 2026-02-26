/* ======================================================
   CAMS Google Drive Sync (Clean Architecture)
====================================================== */
if (!window.lastDriveSaveTime) {
    window.lastDriveSaveTime = 0;
}
let driveSaveInProgress = false;
let pendingDriveSave = false;

const DRIVE_SAVE_COOLDOWN = 3000; // 3 seconds

const CLIENT_ID = "409554142750-06633a3io1pl5pdjh35a8hl097ipj171.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.appdata";

let tokenClient = null;
let accessToken = null;
window.driveEnabled = false;

/* ======================================================
   UI HELPERS
====================================================== */

function showLoggedIn() {
    googleLoginBtn.style.display = "none";
    disconnectGoogleBtn.style.display = "inline-block";
    manualSyncBtn.style.display = "inline-block";
}

function showLoggedOut() {
    googleLoginBtn.style.display = "inline-block";
    disconnectGoogleBtn.style.display = "none";
    manualSyncBtn.style.display = "none";
}

function updateSyncStatus(text) {
    const el = document.getElementById("syncStatus");
    if (el) el.textContent = text;
}

/* ======================================================
   GOOGLE INITIALIZATION
====================================================== */

function initializeGoogle() {

    gapi.load("client", async () => {

        await gapi.client.init({
            discoveryDocs: [
                "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"
            ]
        });

        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            auto_select: true,

            callback: async (resp) => {

                if (resp.error) {
                    showLoggedOut();
                    updateSyncStatus("Offline");
                    return;
                }

                console.log("✅ Google session restored");

                accessToken = resp.access_token;
                gapi.client.setToken({ access_token: accessToken });
                driveEnabled = true;
                localStorage.setItem("driveConnected", "true");

                await finishDriveConnection();
            }
        });
        trySilentRestore();

        /* ⭐ Silent login attempt EVERY page load */
        //tokenClient.requestAccessToken({ prompt: "" });
    });
}

async function trySilentRestore() {

    if (localStorage.getItem("driveConnected") !== "true")
        return;

    console.log("Attempting silent restore...");

    try {
        tokenClient.requestAccessToken({
            prompt: ""   // silent only
        });
    } catch (e) {
        console.log("Silent restore failed");
    }
}
/* ======================================================
   USER LOGIN (POPUP)
====================================================== */

function connectGoogleDrive() {
    if (!tokenClient) return;

    updateSyncStatus("Connecting...");
    tokenClient.requestAccessToken({ prompt: "consent" });
}

/* ======================================================
   DISCONNECT
====================================================== */

function disconnectGoogle() {

    if (accessToken) {
        google.accounts.oauth2.revoke(accessToken);
    }

    accessToken = null;
    driveEnabled = false;
    localStorage.removeItem("driveConnected");

    showLoggedOut();
    updateSyncStatus("Offline");

    console.log("Disconnected");
}

/* ======================================================
   DRIVE FILE HELPERS
====================================================== */

async function findDataFile() {

    const response = await gapi.client.drive.files.list({
        spaces: "appDataFolder",
        fields: "files(id,name,modifiedTime)",
        supportsAllDrives: true
    });

    const files = response.result.files || [];
    console.log("Drive files:", files);

    return files.find(file => file.name === "data.json") || null;
}

async function loadFromDrive() {

    const file = await findDataFile();
    if (!file) return null;

    const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
        {
            headers: { Authorization: `Bearer ${accessToken}` }
        }
    );


    if (!res.ok) {
        console.error("Drive save failed", res);
        return;
    }

    console.log("Saved to Drive");

    console.log("Loaded from Drive");
    return await res.json();
}

/* ======================================================
   DRIVE SAVE DEBOUNCE
====================================================== */

let saveTimer = null;

function scheduleDriveSave() {

    clearTimeout(saveTimer);

    saveTimer = setTimeout(() => {
        console.log("Debounced save → Drive");
        saveToDrive(actors);
    }, 1500);
}

// expose globally so script.js can call it
window.scheduleDriveSave = scheduleDriveSave;

async function saveToDrive(data) {

    if (driveSaveInProgress) {
        pendingDriveSave = true;
        return;
    }

    driveSaveInProgress = true;

    try {

        if (!driveEnabled || !accessToken) {
            console.log("Drive not ready, skipping save");
            return;
        }

        /* ⭐ ADD THIS BLOCK HERE */
        const now = Date.now();

        if (now - window.lastDriveSaveTime < DRIVE_SAVE_COOLDOWN) {
            console.log("Drive cooldown active → delaying save");
            pendingDriveSave = true;
            return;
        }
        let file = await findDataFile();

        const metadata = {
            name: "data.json",
            parents: ["appDataFolder"]
        };

        /* ✅ ADD THIS (MISSING URL) */
        const url = file
            ? `https://www.googleapis.com/upload/drive/v3/files/${file.id}?uploadType=multipart&supportsAllDrives=true&includeItemsFromAllDrives=true`
            : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&includeItemsFromAllDrives=true`;

        const boundary = "cams_boundary";

        const body =
            `--${boundary}\r\n` +
            "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
            JSON.stringify(metadata) + "\r\n" +
            `--${boundary}\r\n` +
            "Content-Type: application/json\r\n\r\n" +
            JSON.stringify(data) + "\r\n" +
            `--${boundary}--`;

        const fileContent = JSON.stringify(data);

        if (file) {

            // UPDATE existing file
            await gapi.client.request({
                path: `/upload/drive/v3/files/${file.id}`,
                method: "PATCH",
                params: {
                    uploadType: "media"
                },
                headers: {
                    "Content-Type": "application/json"
                },
                body: fileContent
            });

        } else {

            // CREATE new file
            const create = await gapi.client.drive.files.create({
                resource: {
                    name: "data.json",
                    parents: ["appDataFolder"]
                },
                media: {
                    mimeType: "application/json",
                    body: fileContent
                },
                fields: "id"
            });

            console.log("Created file:", create.result.id);
        }

        console.log("Saved to Drive");
        window.lastDriveSaveTime = Date.now();

    } finally {

        // ⭐ ALWAYS release lock
        driveSaveInProgress = false;

        if (pendingDriveSave) {
            pendingDriveSave = false;
            console.log("Running queued save...");
            saveToDrive(actors);
        }
    }
}

/* ======================================================
   CONNECTION FINALIZER
====================================================== */

async function finishDriveConnection() {

    showLoggedIn();
    updateSyncStatus("Syncing...");
    const cloudData = await loadFromDrive();

    if (Array.isArray(cloudData) && cloudData.length > 0) {

        // merge cloud + local
        const merged = window.mergeActors(actors, cloudData);

        actors.length = 0;
        actors.push(...merged);

        localStorage.setItem("actors", JSON.stringify(actors));
        render();

    } else {

        console.log("No cloud file found. Creating new one...");

        // FIRST DEVICE → upload local database
        await saveToDrive(actors);
    }

    updateSyncStatus("Synced");
    /*if (!window.driveWatcher) {
 
         window.driveWatcher = setInterval(async () => {
 
             if (!driveEnabled) return;
 
             const cloudData = await loadFromDrive();
             if (!Array.isArray(cloudData)) return;
 
             const merged =
                 window.mergeActors(actors, cloudData);
 
             actors.length = 0;
             actors.push(...merged);
 
             localStorage.setItem("actors", JSON.stringify(actors));
             render();
 
             console.log("Background sync complete");
 
         }, 30000); // every 30 seconds
     }*/
}

/* ======================================================
   MANUAL SYNC
====================================================== */

async function manualDriveSync() {

    if (!driveEnabled) return;

    updateSyncStatus("Syncing...");

    console.log("Manual sync started");

    const cloudData = await loadFromDrive();
    if (!Array.isArray(cloudData)) {
        updateSyncStatus("Synced");
        return;
    }

    const merged = window.mergeActors(actors, cloudData);

    actors.length = 0;
    actors.push(...merged);

    localStorage.setItem("actors", JSON.stringify(actors));
    render();

    updateSyncStatus("Synced");

    console.log("Manual sync complete");
}

/* ======================================================
   AUTO START
====================================================== */

window.addEventListener("load", initializeGoogle);