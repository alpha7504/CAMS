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

async function initGoogleDrive() {
    return new Promise((resolve) => {

        gapi.load("client", async () => {

            await gapi.client.init({
                discoveryDocs: [
                    "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"
                ]
            });

            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: SCOPES,
                callback: (resp) => {

                    if (resp.error) {
                        console.error("Google Auth Error", resp);
                        return;
                    }

                    accessToken = resp.access_token;
                    driveReady = true;
                    resolve();
                }
            });
        });
    });
}

/* --------------------------------
   Login
-------------------------------- */

function loginGoogle() {
    return new Promise((resolve) => {

        tokenClient.callback = (resp) => {

            if (resp.error) {
                console.error("Login failed", resp);
                return;
            }

            accessToken = resp.access_token;
            driveReady = true;
            resolve();
        };

        tokenClient.requestAccessToken();
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

async function connectGoogleDrive(currentActors) {

    updateSyncStatus("Connecting...");

    await initGoogleDrive();
    await loginGoogle();

    driveEnabled = true;

    const cloudData = await loadFromDrive();

    // ✅ If valid cloud data exists → MERGE
    if (Array.isArray(cloudData) && cloudData.length > 0) {

        const merged = mergeActors(actors, cloudData);

        // replace contents safely (keep same array reference)
        actors.length = 0;
        actors.push(...merged);

        // update local cache
        localStorage.setItem("actors", JSON.stringify(actors));

        // push healed dataset back to cloud
        await saveToDrive(actors);

        render();
    }
    else {
        // ✅ first login → upload local data
        await saveToDrive(currentActors);
    }

    updateSyncStatus("Synced");
}