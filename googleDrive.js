/* ======================================================
   CAMS Google Drive Sync (Clean Architecture)
====================================================== */

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
}

function showLoggedOut() {
    googleLoginBtn.style.display = "inline-block";
    disconnectGoogleBtn.style.display = "none";
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

                await finishDriveConnection();
            }
        });

        /* ⭐ Silent login attempt EVERY page load */
        tokenClient.requestAccessToken({ prompt: "" });
    });
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
        fields: "files(id,name)",
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

    console.log("Loaded from Drive");
    return await res.json();
}

async function saveToDrive(data) {

    if (!driveEnabled || !accessToken) return;

    let file = await findDataFile();

    const metadata = {
        name: "data.json",
        parents: ["appDataFolder"]
    };

    const form = new FormData();

    form.append(
        "metadata",
        new Blob([JSON.stringify(metadata)], { type: "application/json" })
    );

    form.append(
        "file",
        new Blob([JSON.stringify(data)], { type: "application/json" })
    );

    const url = file
        ? `https://www.googleapis.com/upload/drive/v3/files/${file.id}?uploadType=multipart&supportsAllDrives=true`
        : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`;

    await fetch(url, {
        method: file ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form
    });

    console.log("Saved to Drive");
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
}

/* ======================================================
   AUTO START
====================================================== */

window.addEventListener("load", initializeGoogle);