/* ================================
   CAMS Google Drive Storage
================================ */

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
   GOOGLE INIT (UPDATED)
================================ */
function initializeGoogle() {
    gapi.load("client", async () => {
        await gapi.client.init({
            discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"]
        });

        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: async (resp) => {
                // If silent refresh fails, we stop the "Connecting" hang
                if (resp.error !== undefined) {
                    console.warn("Silent login failed", resp.error);
                    updateSyncStatus("Offline");
                    document.getElementById("googleLoginBtn").style.display = "inline-block";
                    return;
                }

                accessToken = resp.access_token;
                driveReady = true;
                driveEnabled = true;

                // Save email to localStorage for future silent hints
                fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
                    headers: { Authorization: `Bearer ${accessToken}` }
                })
                .then(res => res.json())
                .then(data => {
                    if (data.email) localStorage.setItem("cams_user_hint", data.email);
                })
                .catch(() => console.log("Hint fetch failed"));

                await finishDriveConnection();
            }
        });

        // Trigger silent refresh if we were previously connected
        const wasConnected = localStorage.getItem("cams_drive_connected");
        const userHint = localStorage.getItem("cams_user_hint");

        if (wasConnected) {
            updateSyncStatus("Connecting...");
            tokenClient.requestAccessToken({ 
                prompt: "none", 
                login_hint: userHint || undefined 
            });
        }
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

    // Set UI state
    document.getElementById("googleLoginBtn").style.display = "none";
    document.getElementById("disconnectGoogleBtn").style.display = "inline-block";

    // 1. Fetch latest data from Cloud
    const cloudData = await loadFromDrive();
    
    if (cloudData) {
        // 2. Merge cloud data with local data, keeping the newest versions
        actors = mergeActors(actors, cloudData);
        
        // 3. Save the merged result back to local storage and refresh UI
        localStorage.setItem("actors", JSON.stringify(actors));
        if (typeof render === "function") render();
    }

    updateSyncStatus("Synced");
    localStorage.setItem("cams_drive_connected", "1");
    
    // 4. Send the local state to cloud to ensure both are identical
    await saveToDrive(actors);
}

window.addEventListener("load", () => {
    initializeGoogle();

    const wasConnected = localStorage.getItem("cams_drive_connected");
    const userHint = localStorage.getItem("cams_user_hint");

    if (wasConnected) {
        updateSyncStatus("Connecting..."); // Let the user know we are trying
        setTimeout(() => {
            if (tokenClient) {
                tokenClient.requestAccessToken({
                    prompt: "none",
                    login_hint: userHint || undefined
                });
            }
        }, 1500);
    }
});