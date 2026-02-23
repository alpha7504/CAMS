/* ================================
   CAMS Google Drive Storage
================================ */
let googleInitialized = false;
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
   GOOGLE INIT (RUN ON PAGE LOAD)
================================ */

function initializeGoogle() {
    updateSyncStatus("Offline");

    gapi.load("client", async () => {

        await gapi.client.init({
            discoveryDocs: [
                "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"
            ]
        });

        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,

            // ⭐ THIS IS THE IMPORTANT PART
            callback: async (resp) => {

                if (resp.error) {
                    console.error(resp);
                    return;
                }

                accessToken = resp.access_token;
                driveReady = true;
                driveEnabled = true;

                console.log("Google connected");

                if (!connectionInitialized) {
                    googleInitialized = true;
                    await finishDriveConnection();
                }
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

/* ===============================
   FINALIZE CONNECTION AFTER TOKEN
================================ */

async function finishDriveConnection() {

    updateSyncStatus("Syncing...");

    const cloudData = await loadFromDrive();

    if (Array.isArray(cloudData) && cloudData.length > 0) {

        const merged = mergeActors(actors, cloudData);

        actors.length = 0;
        actors.push(...merged);

        localStorage.setItem("actors", JSON.stringify(actors));

        await saveToDrive(actors);

        render();
    }

    document.getElementById("googleLoginBtn").style.display = "none";
    document.getElementById("disconnectGoogleBtn").style.display = "inline-block";

    updateSyncStatus("Synced");
    localStorage.setItem("cams_drive_connected", "1");
}

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

    console.log("Disconnected from Google");
    localStorage.removeItem("cams_drive_connected");
}

window.addEventListener("load", () => {

    initializeGoogle();

    // attempt silent reconnect ONLY if user connected before
    const wasConnected =
        localStorage.getItem("cams_drive_connected");

    if (wasConnected) {

        console.log("Restoring previous Drive session...");

        setTimeout(() => {
            requestToken(""); // silent login
        }, 800);
    }
});
