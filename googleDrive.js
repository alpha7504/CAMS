/* ================================
   CAMS Google Drive Storage
================================ */
let googleReadyResolve;
const googleReady = new Promise(res => {
    googleReadyResolve = res;
});
const CLIENT_ID = "409554142750-06633a3io1pl5pdjh35a8hl097ipj171.apps.googleusercontent.com";
// Added email scope for the login_hint
const SCOPES = "https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email";

let tokenClient = null;
let accessToken = null;
let driveReady = false;
let driveEnabled = false;

/* --------------------------------
   Initialize Google API
-------------------------------- */

/* ================================
   GDRIVE PERSISTENT SYNC LOGIC
================================ */

function initializeGoogle() {
    gapi.load("client", async () => {
        await gapi.client.init({
            discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"]
        });

        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            auto_select: true,
            callback: async (resp) => {

                if (resp.error) {
                    updateSyncStatus("Offline");
                    return;
                }

                accessToken = resp.access_token;
                driveEnabled = true;

                localStorage.setItem("cams_drive_connected", "1");

                await finishDriveConnection();
            }
        });

        // ⭐ SIGNAL GOOGLE IS READY
        googleReadyResolve();

        const wasConnected = localStorage.getItem("cams_drive_connected");
        const userHint = localStorage.getItem("cams_user_hint");

        // Silent login check on page load
        if (wasConnected) {
            updateSyncStatus("Connecting...");
            setTimeout(() => {
                if (tokenClient) {
                    tokenClient.requestAccessToken({
                        prompt: "none",
                        login_hint: userHint || undefined
                    });
                }
            }, 1000);
        }
    });
}

async function saveToDrive(data) {
    if (!driveReady || !accessToken) return;

    try {
        const fileId = await findDataFile();
        const metadata = { name: "actors_data.json", mimeType: "application/json" };
        const content = JSON.stringify(data);
        const blob = new Blob([content], { type: "application/json" });

        let url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
        let method = "POST";

        // If file exists, we try to update it
        if (fileId) {
            url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
            method = "PATCH";
        }

        const form = new FormData();
        form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
        form.append("file", blob);

        const response = await fetch(url, {
            method,
            headers: { Authorization: `Bearer ${accessToken}` },
            body: form
        });

        // Handle 403 or 404 by creating a new file instead
        if (!response.ok) {
            if (response.status === 403 || response.status === 404) {
                console.warn("Retrying with new file creation");
                return saveToDriveNew(data);
            }
            throw new Error("Upload failed");
        }

        console.log("Saved to Drive");
    } catch (err) {
        console.error("Save error", err);
    }
}

async function saveToDriveNew(data) {
    const metadata = { name: "actors_data.json", parents: ["appDataFolder"] };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", new Blob([JSON.stringify(data)], { type: "application/json" }));

    await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form
    });
}


/* --------------------------------
   Login
-------------------------------- */

async function requestToken(promptType = "") {

    await googleReady;   // wait until tokenClient exists

    tokenClient.requestAccessToken({
        prompt: promptType
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

function updateSyncStatus(msg) {
    const el = document.getElementById("syncStatus");
    if (!el) return;

    el.innerText = msg;

    // Change color based on status
    if (msg === "Synced") {
        el.style.color = "green";
        el.innerText = "☁️ Synced";
    } else if (msg === "Syncing...") {
        el.style.color = "orange";
    } else if (msg === "Offline") {
        el.style.color = "#888";
    }
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
        google.accounts.oauth2.revoke(accessToken, () => { });
    }

    accessToken = null;
    driveEnabled = false;
    updateSyncStatus("Offline");

    // Clear everything so the next refresh is clean
    localStorage.removeItem("cams_drive_connected");
    localStorage.removeItem("cams_user_hint");

    document.getElementById("disconnectGoogleBtn").style.display = "none";
    document.getElementById("googleLoginBtn").style.display = "inline-block";
}

/* ===============================
   FINALIZE CONNECTION AFTER TOKEN
================================ */
async function finishDriveConnection() {
    updateSyncStatus("Syncing...");

    // Update UI immediately
    document.getElementById("googleLoginBtn").style.display = "none";
    document.getElementById("disconnectGoogleBtn").style.display = "inline-block";

    // 1. Fetch data from Google Drive
    const cloudData = await loadFromDrive();

    if (cloudData && Array.isArray(cloudData)) {
        // 2. Use the merge logic to combine local and cloud
        actors = mergeActors(actors, cloudData);

        // 3. Save merged data and refresh UI
        localStorage.setItem("actors", JSON.stringify(actors));
        if (typeof render === "function") render();
    }

    updateSyncStatus("Synced");

    // Set persistence flag
    localStorage.setItem("cams_drive_connected", "1");

    // 4. Update cloud with merged results
    await saveToDrive(actors);
}

/* ===============================
   AUTO-RESTORE SESSION (NO POPUPS)
================================ */
window.addEventListener("load", async () => {

    initializeGoogle();

    if (localStorage.getItem("cams_drive_connected")) {
        await requestToken("");   // silent restore
    }
});