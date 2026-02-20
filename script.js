/* ===============================
   ELEMENT REFERENCES
================================ */

const pasteBox = document.getElementById("pasteBox");
const eng = document.getElementById("eng");
const cn = document.getElementById("cn");
const tags = document.getElementById("tags");
const grid = document.getElementById("grid");
const search = document.getElementById("search");
const imgUrl = document.getElementById("imgUrl");
const popup = document.getElementById("popup");
const popupContent = document.getElementById("popupContent");

/* ===============================
   DATA STORAGE
================================ */

let actors = JSON.parse(localStorage.getItem("actors")) || [];
let nameDict =
    JSON.parse(localStorage.getItem("nameDict")) || {};

let pastedImage = "";
let editIndex = null;
let lookupTimer = null;
let lastImportedActorId = null;


const PLACEHOLDER_IMAGE = "assets/pp.png";


function getActorImage(actor) {
    if (!actor.image || actor.image.trim() === "") {
        return PLACEHOLDER_IMAGE;
    }
    return actor.image;
}



/* ===============================
   AUTOCOMPLETE UI
================================ */

const autoBox = document.createElement("div");
autoBox.style.position = "absolute";
autoBox.style.background = "white";
autoBox.style.border = "1px solid #ccc";
autoBox.style.display = "none";
autoBox.style.zIndex = "1000";
document.body.appendChild(autoBox);

let autoIndex = -1;
let autoList = [];



/* ===============================
   PINYIN SORT KEY
================================ */

function getPinyinKey(text) {
    return (text || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

/* ===============================
   SIMPLE OFFLINE PINYIN GENERATOR
================================ */

const pinyinMap = {
    "杨": "yang", "幂": "mi",
    "肖": "xiao", "战": "zhan",
    "王": "wang", "一": "yi", "博": "bo",
    "赵": "zhao", "丽": "li", "颖": "ying",
    "迪": "di", "热": "re", "巴": "ba",
    "刘": "liu", "诗": "shi", "诗": "shi",
    "吴": "wu", "磊": "lei",
    "李": "li", "现": "xian",
    "陈": "chen", "飞": "fei", "宇": "yu"
    // you can expand anytime
};

/* ===============================
   FULL OFFLINE PINYIN ENGINE
================================ */

/* ===============================
   FULL OFFLINE PINYIN ENGINE
================================ */

function generatePinyin(chinese) {

    if (!window.pinyinPro) return null;

    try {

        const result = window.pinyinPro.pinyin(
            chinese,
            {
                toneType: "none",
                type: "array"
            }
        );

        // Capitalize words
        return result
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");

    } catch {
        return null;
    }
}






/* ===============================
   IMAGE OPTIMIZER
================================ */

async function optimizeImage(base64) {

    return new Promise(resolve => {

        const img = new Image();
        img.src = base64;

        img.onload = () => {

            // slightly larger portrait
            const MAX_SIZE = 280;

            // allow better quality
            const TARGET_SIZE = 45000; // ~45 KB

            let width = img.width;
            let height = img.height;

            // keep aspect ratio
            if (width > height && width > MAX_SIZE) {
                height *= MAX_SIZE / width;
                width = MAX_SIZE;
            } else if (height > MAX_SIZE) {
                width *= MAX_SIZE / height;
                height = MAX_SIZE;
            }

            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");

            canvas.width = width;
            canvas.height = height;

            // smoother resize
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";

            ctx.drawImage(img, 0, 0, width, height);

            // gentler compression loop
            let quality = 0.85;
            let result;

            do {
                result = canvas.toDataURL("image/jpeg", quality);
                quality -= 0.05;
            }
            while (result.length > TARGET_SIZE && quality > 0.55);

            resolve(result);
        };
    });
}

/* ===============================
   IMAGE PASTE
================================ */

pasteBox.addEventListener("paste", e => {
    for (const item of e.clipboardData.items) {
        if (item.type.includes("image")) {
            const reader = new FileReader();
            reader.onload = async ev => {
                pastedImage =
                    await optimizeImage(ev.target.result);
                pasteBox.innerHTML =
                    `<img src="${pastedImage}" height="120">`;
            };
            reader.readAsDataURL(item.getAsFile());
        }
    }
});

/* ===============================
   IMAGE FROM URL
================================ */

async function loadImageFromURL() {

    if (!imgUrl.value) return;

    try {
        const r = await fetch(imgUrl.value);
        const blob = await r.blob();
        const reader = new FileReader();

        reader.onload = async e => {
            pastedImage =
                await optimizeImage(e.target.result);
            pasteBox.innerHTML =
                `<img src="${pastedImage}" height="120">`;
        };

        reader.readAsDataURL(blob);

    } catch {
        alert("Image blocked. Use paste.");
    }
}

/* ===============================
   SMART AUTOCOMPLETE
================================ */

cn.addEventListener("input", () => {

    const val = cn.value.trim();
    autoIndex = -1;

    if (!val) {
        autoBox.style.display = "none";
        return;
    }

    /* 1️⃣ Learned dictionary */
    if (nameDict[val]) {
        eng.value = nameDict[val];
        return;
    }

    /* 2️⃣ Offline pinyin guess */
    const guess = generatePinyin(val);
    if (guess) {
        eng.value = guess;
    }

    /* 3️⃣ Debounced ONLINE lookup */
    clearTimeout(lookupTimer);

    lookupTimer = setTimeout(async () => {

        const currentName = cn.value.trim();

        // stop if user changed text
        if (currentName !== val) return;

        let result = await lookupEnglishName(currentName);

        // ONLINE SUCCESS
        if (result) {
            eng.value = result;
            return;
        }

        // FALLBACK TO PINYIN
        const fallback = generatePinyin(currentName);

        if (fallback) {
            eng.value = fallback;
        }

    }, 600);
    // wait 600ms after typing/paste

});







/* click select */

autoBox.addEventListener("mousedown", e => {
    const text = e.target.innerText;
    const cnName = text.split(" (")[0];
    cn.value = cnName;
    eng.value = nameDict[cnName];
    autoBox.style.display = "none";
});

/* keyboard navigation */

async function lookupEnglishName(chineseName) {

    try {

        const url =
            `https://www.wikidata.org/w/api.php?action=wbsearchentities` +
            `&search=${encodeURIComponent(chineseName)}` +
            `&language=zh&format=json&origin=*`;

        const res = await fetch(url);
        const data = await res.json();

        if (!data.search || data.search.length === 0)
            return null;

        const entityId = data.search[0].id;

        const detailUrl =
            `https://www.wikidata.org/wiki/Special:EntityData/${entityId}.json`;

        const detailRes = await fetch(detailUrl);
        const detailData = await detailRes.json();

        const entity = detailData.entities[entityId];

        if (entity.labels && entity.labels.en) {
            return entity.labels.en.value;
        }

        return null;

    } catch (err) {
        console.log("Lookup failed:", err);
        return null;
    }
}


cn.addEventListener("keydown", e => {

    if (autoBox.style.display === "none") return;

    if (e.key === "ArrowDown") {
        autoIndex = (autoIndex + 1) % autoList.length;
        highlightAuto();
        e.preventDefault();
    }

    if (e.key === "ArrowUp") {
        autoIndex--;
        if (autoIndex < 0) autoIndex = autoList.length - 1;
        highlightAuto();
        e.preventDefault();
    }

    if (e.key === "Enter" && autoIndex >= 0) {
        const name = autoList[autoIndex];
        cn.value = name;
        eng.value = nameDict[name];
        autoBox.style.display = "none";
        e.preventDefault();
    }
});

function highlightAuto() {
    [...autoBox.children].forEach((el, i) => {
        el.style.background =
            i === autoIndex ? "#eee" : "white";
    });
}

/* ===============================
   SAVE ACTOR
================================ */

function saveActor() {

    const data = {
        id: Date.now(),
        english: eng.value.trim(),
        chinese: cn.value.trim(),
        pinyin: getPinyinKey(eng.value),
        tags: tags.value.split(",").map(t => t.trim()).filter(Boolean),
        favorite: false,
        image: pastedImage
    };

    if (!data.english || !data.chinese || !data.image) {
        alert("Complete all fields");
        return;
    }

    const duplicate = actors.find(a =>
        a.chinese === data.chinese ||
        (a.english || "").toLowerCase() === data.english.toLowerCase()
    );

    if (duplicate && editIndex === null) {
        alert("Actor already exists.");
        return;
    }

    // learn dictionary automatically
    nameDict[data.chinese] = data.english;
    localStorage.setItem("nameDict", JSON.stringify(nameDict));

    if (editIndex !== null) {
        data.favorite = actors[editIndex].favorite;
        actors[editIndex] = data;
        editIndex = null;
    } else {
        actors.push(data);
    }

    localStorage.setItem("actors", JSON.stringify(actors));

    eng.value = "";
    cn.value = "";
    tags.value = "";
    imgUrl.value = "";
    pastedImage = "";
    pasteBox.innerHTML = "Paste Image Here";

    render();
}

/* ===============================
   FAVORITE / DELETE / EDIT
================================ */

function toggleFavorite(i) {
    actors[i].favorite = !actors[i].favorite;
    localStorage.setItem("actors", JSON.stringify(actors));
    render();
}

function deleteActor(i) {
    if (confirm("Delete actor?")) {
        actors.splice(i, 1);
        localStorage.setItem("actors", JSON.stringify(actors));
        render();
    }
}

function editActor(i) {
    const a = actors[i];
    eng.value = a.english;
    cn.value = a.chinese;
    tags.value = (a.tags || []).join(",");
    pastedImage = a.image;
    pasteBox.innerHTML = `<img src="${a.image}" height="120">`;
    editIndex = i;
}

/* ===============================
   POPUP
================================ */

function openProfile(i) {
    const a = actors[i];
    popupContent.innerHTML = `
        <img src="${a.image ? a.image : PLACEHOLDER_IMAGE}"
     onerror="this.onerror=null;this.src='assets/pp.png';"
     width="100%">
        <h3>${a.english}</h3>
        <h4>${a.chinese}</h4>
        <p>${(a.tags || []).join(", ")}</p>
        <button onclick="closePopup()">Close</button>`;
    popup.style.display = "block";
}
function closePopup() { popup.style.display = "none"; }

/* ===============================
   EXPORT / IMPORT
================================ */

function exportData() {
    const blob = new Blob(
        [JSON.stringify(actors, null, 2)],
        { type: "application/json" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "actors_backup.json";
    a.click();
}

function importData(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = ev => {
        actors = JSON.parse(ev.target.result);
        localStorage.setItem("actors", JSON.stringify(actors));
        render();
    };
    reader.readAsText(file);
}

async function importActorFromURL() {

    const pageUrl =
        document.getElementById("actorUrl").value.trim();

    if (!pageUrl) {
        alert("Enter actor URL.");
        return false;
    }

    try {

        const proxy =
            "https://corsproxy.io/?" +
            encodeURIComponent(pageUrl);

        const res = await fetch(proxy);
        const html = await res.text();

        /* ===== EXTRACT NAME ===== */
        const nameMatch = html.match(
            /<h1[^>]*>(.*?)<\/h1>/i
        );

        if (!nameMatch) {
            alert("Actor name not found.");
            return false;
        }

        const chinese = nameMatch[1].trim();

        /* ===== DUPLICATE CHECK ===== */
        if (actors.find(a => a.chinese === chinese)) {
            alert("Actor already exists.");
            return false;
        }

        /* ===== EXTRACT IMAGE ===== */
        let finalImage = null;

        const imgMatch = html.match(
            /https?:\/\/[^"' ]*fqnovelpic[^"' ]*\.jpeg[^"' ]*/i
        );

        if (imgMatch) {
            finalImage =
                imgMatch[0].replace(/&amp;/g, "&");
        }

        /* ===== ENGLISH NAME ===== */
        let english =
            nameDict[chinese] ||
            await lookupEnglishName(chinese) ||
            generatePinyin(chinese) ||
            "";

        const actor = {
            id: Date.now() + Math.random(),
            english,
            chinese,
            pinyin: getPinyinKey(english),
            tags: [],
            favorite: false,
            image: finalImage
        };


        nameDict[chinese] = english;

        localStorage.setItem("actors", JSON.stringify(actors));
        localStorage.setItem("nameDict", JSON.stringify(nameDict));

        actors.push(actor);
        lastImportedActorId = actor.id;
        render();
        highlightImportedActor();

        alert("Actor imported successfully.");
        return true;

    } catch (err) {
        console.error(err);
        alert("Import failed.");
        return false;
    }
}



/* ===============================
   RENDER
================================ */

function render() {

    const q = search.value.toLowerCase();
    grid.innerHTML = "";

    [...actors]
        .sort((a, b) => (a.pinyin || "").localeCompare(b.pinyin || ""))
        .filter(a =>
            (a.english || "").toLowerCase().includes(q) ||
            (a.chinese || "").includes(q) ||
            (a.tags || []).join().toLowerCase().includes(q)
        )
        .forEach((a, i) => {

            grid.innerHTML += `
        <div class="card" data-actor-id="${a.id}">
            <img src="${a.image ? a.image : PLACEHOLDER_IMAGE}"
     onerror="this.onerror=null;this.src='assets/pp.png';"
     onclick="openProfile(${i})">
            <div class="card-body">
                <b>${a.english}</b><br>
                ${a.chinese}<br>
                ${(a.tags || []).map(t => `<span class="tag">${t}</span>`).join("")}
                <br><br>
                    <div class="card-actions">
                        <button onclick="toggleFavorite(${i})">
                            ${a.favorite ? "⭐" : "☆"}
                        </button>
                        <button onclick="editActor(${i})">Edit</button>
                        <button onclick="deleteActor(${i})">Delete</button>
                    </div>

            </div>
        </div>`;
        });
}

async function bulkImport() {

    const text =
        document.getElementById("bulkInput").value;

    if (!text.trim()) {
        alert("No names provided");
        return;
    }

    const names = text
        .split("\n")
        .map(n => n.trim())
        .filter(Boolean);

    let added = 0;

    for (const chinese of names) {

        // skip duplicates
        const exists = actors.find(a =>
            a.chinese === chinese
        );

        if (exists) continue;

        // dictionary first
        let english = nameDict[chinese];

        // online lookup
        if (!english) {
            english = await lookupEnglishName(chinese);
        }

        // pinyin fallback
        if (!english) {
            english = generatePinyin(chinese) || "";
        }

        const actor = {
            id: Date.now() + Math.random(),
            english,
            chinese,
            pinyin: getPinyinKey(english),
            tags: [],
            favorite: false,
            image: null // add later manually
        };

        actors.push(actor);

        if (english) {
            nameDict[chinese] = english;
        }

        added++;
    }

    localStorage.setItem("actors", JSON.stringify(actors));
    localStorage.setItem("nameDict", JSON.stringify(nameDict));

    render();

    alert(`${added} actors imported.`);
}

function bulkImportFile(event) {

    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = e => {
        document.getElementById("bulkInput").value =
            e.target.result;
    };

    reader.readAsText(file);
}

function deleteAllProfiles() {

    const confirm1 = confirm(
        "Delete ALL actor profiles?\nThis cannot be undone."
    );

    if (!confirm1) return;

    const confirm2 = confirm(
        "Are you absolutely sure?\nAll profiles will be permanently removed."
    );

    if (!confirm2) return;

    actors = [];

    localStorage.removeItem("actors");

    render();

    alert("All profiles deleted.");
}



function highlightImportedActor() {

    if (!lastImportedActorId) return;

    // wait for DOM + paint + layout
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {

            const card = document.querySelector(
                `[data-actor-id="${lastImportedActorId}"]`
            );

            if (!card) {
                console.log("Highlight target not found");
                return;
            }

            card.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });

            card.classList.add("highlight");

            setTimeout(() => {
                card.classList.remove("highlight");
            }, 2500);

            lastImportedActorId = null;
        });
    });
}






/* ===============================
   BACKGROUND IMPORT LISTENER
================================ */

if (typeof GM_addValueChangeListener !== "undefined") {

    GM_addValueChangeListener("camsImportURL",
        function (name, oldValue, newValue) {

            if (newValue) {

                document.getElementById("actorUrl").value = newValue;
                importActorFromURL();
            }
        }
    );
}



console.log("CAMS catalog loaded");
search.addEventListener("input", render);




/* ===============================
   AUTO IMPORT FROM URL PARAM
================================ */

window.addEventListener("load", () => {

    const params = new URLSearchParams(window.location.search);
    const importUrl = params.get("import");

    console.log("Import param:", importUrl);

    if (!importUrl) return;

    // wait a little to ensure UI fully ready
    setTimeout(() => {

        const input = document.getElementById("actorUrl");

        if (!input) {
            console.log("actorUrl still missing");
            return;
        }

        input.value = importUrl;

        importActorFromURL().then(() => {

            // remove parameter so refresh won't repeat
            window.history.replaceState(
                {},
                document.title,
                window.location.pathname
            );

        });

    }, 1200); // IMPORTANT: longer delay for GitHub Pages

});

/* ===============================
   LIVE IMPORT CHANNEL
================================ */

const camsChannel = new BroadcastChannel("cams_import");

camsChannel.onmessage = (event) => {

    const actorUrl = event.data;

    console.log("Live import received:", actorUrl);

    const input = document.getElementById("actorUrl");
    if (!input) return;

    input.value = actorUrl;

    importActorFromURL();
};


render();
