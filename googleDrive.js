/* ================================
   CAMS Google Drive Storage
================================ */

const CLIENT_ID = "409554142750-06633a3io1pl5pdjh35a8hl097ipj171.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.appdata";

let tokenClient = null;
let accessToken = null;
let driveReady = false;
let driveEnabled = false;

/* --------------------------------
   Initialize Google API
-------------------------------- */

/* ================================
   GOOGLE INIT (UPDATED)
================================ */
function initializeGoogle() {
    updateSyncStatus("Offline");

    gapi.load("client", async () => {
        await gapi.client.init({
            discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"]
        });

        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            ccallback: async (resp) => {
                if (resp.error) {
                    // If silent attempt fails, show the login button
                    document.getElementById("googleLoginBtn").style.display = "inline-block";
                    return;
                }

                accessToken = resp.access_token;
                driveReady = true;
                driveEnabled = true;

                // ⭐ NEW: Request user info once to get the email for future hints
                if (!localStorage.getItem("cams_user_hint")) {
                    fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
                        headers: { Authorization: `Bearer ${accessToken}` }
                    })
                        .then(res => res.json())
                        .then(data => {
                            if (data.email) localStorage.setItem("cams_user_hint", data.email);
                        });
                }

                await finishDriveConnection();
            }
        });
    });
}



/* --------------------------------
   Login
-------------------------------- */

function requestToken(promptType = "") {

    if (!tokenClient) {
        console.error("Token client not ready");
        return;
    }

    tokenClient.requestAccessToken({
        prompt: promptType   // "" = silent, "consent" = popup
    });
}



/* --------------------------------
   Find data.json
-------------------------------- */

async function findDataFile() {

    const res = await gapi.client.drive.files.list({
        spaces: "appDataFolder",
        fields: "files(id,name)"
    });

    const files = res.result.files || [];
    return files.find(f => f.name === "data.json") || null;
}

/* --------------------------------
   Load Database
-------------------------------- */

async function loadFromDrive() {

    const file = await findDataFile();

    if (!file) {
        console.log("No cloud database found.");
        return null;
    }

    const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        }
    );

    console.log("Loaded from Drive");
    return await res.json();
}

/* --------------------------------
   Save Database
-------------------------------- */

async function saveToDrive(data) {

    if (!driveReady) return;

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
        ? `https://www.googleapis.com/upload/drive/v3/files/${file.id}?uploadType=multipart`
        : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

    await fetch(url, {
        method: file ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form
    });

    console.log("Saved to Drive");
}

/* --------------------------------
   CONNECT BUTTON FLOW
-------------------------------- */

function updateSyncStatus(text) {
    const el = document.getElementById("syncStatus");
    if (el) el.textContent = text;
}

function mergeActors(localActors, cloudActors) {

    const map = new Map();

    // add local first
    localActors.forEach(a => {
        map.set(a.id, a);
    });

    // merge cloud
    cloudActors.forEach(cloud => {

        const local = map.get(cloud.id);

        if (!local) {
            map.set(cloud.id, cloud);
            return;
        }

        // choose newer version
        const localTime = local.updatedAt || local.id;
        const cloudTime = cloud.updatedAt || cloud.id;

        if (cloudTime > localTime) {
            map.set(cloud.id, cloud);
        }
    });

    return Array.from(map.values());
}

async function connectGoogleDrive() {

    updateSyncStatus("Connecting...");

    requestToken("consent"); // popup login
}



/* ================================
   GOOGLE DRIVE PERSISTENCE
================================ */

function disconnectGoogle() {
    if (accessToken) {
        google.accounts.oauth2.revoke(accessToken, () => {
            console.log("Access revoked");
        });
    }

    accessToken = null;
    driveReady = false;
    driveEnabled = false;

    updateSyncStatus("Offline");

    document.getElementById("disconnectGoogleBtn").style.display = "none";
    document.getElementById("googleLoginBtn").style.display = "inline-block";

    // This prevents the app from trying to silent login next time
    localStorage.removeItem("cams_drive_connected");
    localStorage.removeItem("cams_user_hint"); // Clear the hint
}

/* ===============================
   FINALIZE CONNECTION AFTER TOKEN
================================ */

async function finishDriveConnection() {
    updateSyncStatus("Syncing...");

    // Set UI state
    document.getElementById("googleLoginBtn").style.display = "none";
    document.getElementById("disconnectGoogleBtn").style.display = "inline-block";

    const cloudData = await loadFromDrive();
    // ... rest of your merge logic

    updateSyncStatus("Synced");
    localStorage.setItem("cams_drive_connected", "1");
}

window.addEventListener("load", () => {
    initializeGoogle();
    const wasConnected = localStorage.getItem("cams_drive_connected");
    const userHint = localStorage.getItem("cams_user_hint");

    if (wasConnected) {
        setTimeout(() => {
            if (tokenClient) {
                // ⭐ PROMPT NONE + HINT = SILENT LOGIN
                tokenClient.requestAccessToken({ 
                    prompt: "none", 
                    login_hint: userHint 
                });
            }
        }, 1500);
    }
});