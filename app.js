
(() => {
  "use strict";

  const DB_NAME = "BrainDockDB";
  const DB_VERSION = 1;
  const STORE_NAME = "appState";
  const STATE_KEY = "main";
  const defaultProjects = ["Work", "Tallgrass", "School", "Personal", "Finance", "Ideas"];

  let db = null;
  let state = { projects: defaultProjects, captures: [], tasks: [] };
  let recorder = null;
  let chunks = [];
  let audioBlob = null;
  let timerId = null;
  let elapsed = 0;
  let deferredInstallPrompt = null;

  const $ = (id) => document.getElementById(id);
  const safeText = (value) => String(value ?? "").trim();

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDate(iso) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
      }).format(new Date(iso));
    } catch {
      return "";
    }
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => {
        db = request.result;
        resolve(db);
      };

      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("The local database is blocked by another open BrainDock tab."));
    });
  }

  function dbGet(key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function dbPut(key, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Database write was aborted."));
    });
  }

  async function loadState() {
    const saved = await dbGet(STATE_KEY);
    if (saved && Array.isArray(saved.projects) && Array.isArray(saved.captures) && Array.isArray(saved.tasks)) {
      state = saved;
    } else {
      await saveState();
    }
  }

  async function saveState() {
    await dbPut(STATE_KEY, state);
    updateStorageStatus();
  }

  function updateStorageStatus() {
    const captureCount = state.captures.length;
    const taskCount = state.tasks.length;
    $("storageStatus").textContent =
      `${captureCount} capture${captureCount === 1 ? "" : "s"} and ${taskCount} task${taskCount === 1 ? "" : "s"} stored on this device`;
  }

  function populateProjectSelects() {
    ["projectSelect", "taskProject", "recordingProject"].forEach((id) => {
      const select = $(id);
      if (!select) return;
      const current = select.value;
      select.innerHTML = state.projects
        .map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
        .join("");
      if (state.projects.includes(current)) select.value = current;
    });
  }

  function renderAll() {
    populateProjectSelects();
    renderCaptures();
    renderTasks();
    renderProjects();
    updateStorageStatus();
  }

  function captureHtml(item) {
    const text = item.text ? `<p>${escapeHtml(item.text)}</p>` : "";
    const audio = item.audioDataUrl
      ? `<audio controls src="${escapeHtml(item.audioDataUrl)}"></audio>`
      : "";
    return `<article class="item">
      <h4>${escapeHtml(item.title || "Untitled capture")}</h4>
      ${text}
      ${audio}
      <div class="meta">
        <span class="badge">${escapeHtml(item.project || "Inbox")}</span>
        <span>${formatDate(item.createdAt)}</span>
        <span>${escapeHtml(item.kind || "note")}</span>
      </div>
      <div class="item-actions">
        <button data-task-from="${item.id}">Make task</button>
        <button data-delete-capture="${item.id}">Delete</button>
      </div>
    </article>`;
  }

  function renderCaptures() {
    const query = safeText($("searchInput")?.value).toLowerCase();
    const filtered = state.captures
      .filter((item) => !query || [item.title, item.text, item.project].some(v => safeText(v).toLowerCase().includes(query)))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    $("recentList").className = filtered.length ? "list" : "list empty-state";
    $("recentList").innerHTML = filtered.length
      ? filtered.slice(0, 5).map(captureHtml).join("")
      : "Nothing captured yet.";

    $("inboxList").className = filtered.length ? "list" : "list empty-state";
    $("inboxList").innerHTML = filtered.length
      ? filtered.map(captureHtml).join("")
      : "Your inbox is empty.";
  }

  function renderTasks() {
    const tasks = [...state.tasks].sort((a, b) => Number(a.done) - Number(b.done));
    $("taskList").className = tasks.length ? "list" : "list empty-state";
    $("taskList").innerHTML = tasks.length ? tasks.map((task) => `
      <article class="item task-row ${task.done ? "done" : ""}">
        <input type="checkbox" data-toggle-task="${task.id}" ${task.done ? "checked" : ""} aria-label="Complete task">
        <div>
          <h4>${escapeHtml(task.title)}</h4>
          <div class="meta">
            <span class="badge">${escapeHtml(task.project)}</span>
            ${task.due ? `<span>Due ${escapeHtml(task.due)}</span>` : ""}
          </div>
          <div class="item-actions">
            <button data-delete-task="${task.id}">Delete</button>
          </div>
        </div>
      </article>`).join("") : "No tasks yet.";
  }

  function renderProjects() {
    $("projectList").innerHTML = state.projects.map((project) => {
      const count = state.captures.filter((c) => c.project === project).length;
      const tasks = state.tasks.filter((t) => t.project === project && !t.done).length;
      return `<article class="project-card">
        <h3>${escapeHtml(project)}</h3>
        <p>${count} captures · ${tasks} open tasks</p>
      </article>`;
    }).join("");
  }

  async function addCapture({ title, text, project, kind = "note", audioDataUrl = "" }) {
    state.captures.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      title: safeText(title) || "Untitled capture",
      text: safeText(text),
      project: safeText(project) || state.projects[0],
      kind,
      audioDataUrl,
      createdAt: new Date().toISOString()
    });
    await saveState();
    renderAll();
  }

  async function addTask(title, project, due = "") {
    const cleanTitle = safeText(title);
    if (!cleanTitle) return;
    state.tasks.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      title: cleanTitle,
      project: safeText(project) || state.projects[0],
      due,
      done: false
    });
    await saveState();
    renderAll();
  }

  function switchScreen(screenId) {
    document.querySelectorAll(".screen").forEach((el) => el.classList.toggle("active", el.id === screenId));
    document.querySelectorAll(".tabbar button").forEach((el) => el.classList.toggle("active", el.dataset.screen === screenId));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      alert("Audio recording is not supported in this browser. Safari on a current iPhone or Chrome on desktop should work.");
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferred = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]
      .find(type => MediaRecorder.isTypeSupported?.(type));

    recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
    chunks = [];

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };

    recorder.onstop = async () => {
      audioBlob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      const url = URL.createObjectURL(audioBlob);
      $("playback").src = url;
      $("playback").classList.remove("hidden");
      stream.getTracks().forEach((track) => track.stop());
      $("recordingTitle").value = `Voice note ${new Date().toLocaleString()}`;
      $("recordingDialog").showModal();
    };

    recorder.start();
    elapsed = 0;
    $("recordBtn").classList.add("recording");
    $("recordStatus").textContent = "Recording… tap to stop";
    updateTimer();
    timerId = setInterval(updateTimer, 1000);
  }

  function stopRecording() {
    if (recorder?.state === "recording") recorder.stop();
    clearInterval(timerId);
    $("recordBtn").classList.remove("recording");
    $("recordStatus").textContent = "Tap to record";
  }

  function updateTimer() {
    const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const seconds = String(elapsed % 60).padStart(2, "0");
    $("timer").textContent = `${minutes}:${seconds}`;
    elapsed += 1;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function exportBackup() {
    const backup = {
      format: "BrainDock Backup",
      version: 2,
      exportedAt: new Date().toISOString(),
      state
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const filename = `BrainDock-Backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([blob], filename, { type: "application/json" });

    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: "BrainDock Backup",
          text: "Save this file to iCloud Drive in the Files app.",
          files: [file]
        });
        return;
      }
    } catch (error) {
      if (error.name === "AbortError") return;
      console.warn("Share sheet failed, falling back to download:", error);
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function restoreBackup(file) {
    if (!file) return;

    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error("That file is not a valid BrainDock JSON backup.");
    }

    const imported = parsed?.state ?? parsed;
    if (!Array.isArray(imported.projects) || !Array.isArray(imported.captures) || !Array.isArray(imported.tasks)) {
      throw new Error("This does not appear to be a compatible BrainDock backup.");
    }

    const proceed = confirm(
      `Restore ${imported.captures.length} captures and ${imported.tasks.length} tasks? This will replace the current local database.`
    );
    if (!proceed) return;

    state = imported;
    await saveState();
    renderAll();
    alert("BrainDock backup restored.");
  }

  function bindEvents() {
    document.querySelectorAll(".tabbar button").forEach((button) => {
      button.addEventListener("click", () => switchScreen(button.dataset.screen));
    });

    $("recordBtn").addEventListener("click", async () => {
      if (recorder?.state === "recording") stopRecording();
      else {
        try {
          await startRecording();
        } catch (error) {
          console.error(error);
          alert("BrainDock could not start recording. Check microphone permissions and make sure the site is using HTTPS.");
        }
      }
    });

    $("saveNoteBtn").addEventListener("click", async () => {
      const text = safeText($("quickNote").value);
      if (!text) return;
      await addCapture({
        title: text.length > 60 ? `${text.slice(0, 57)}…` : text,
        text,
        project: $("projectSelect").value
      });
      $("quickNote").value = "";
    });

    $("saveRecordingBtn").addEventListener("click", async () => {
      if (!audioBlob) return;
      const dataUrl = await blobToDataUrl(audioBlob);
      await addCapture({
        title: $("recordingTitle").value,
        text: "",
        project: $("recordingProject").value,
        kind: "recording",
        audioDataUrl: dataUrl
      });
      audioBlob = null;
      $("recordingDialog").close();
      $("playback").classList.add("hidden");
      $("timer").textContent = "00:00";
    });

    $("cancelRecordingBtn").addEventListener("click", () => {
      audioBlob = null;
      $("recordingDialog").close();
      $("playback").classList.add("hidden");
      $("timer").textContent = "00:00";
    });

    $("saveTaskBtn").addEventListener("click", async () => {
      await addTask($("taskTitle").value, $("taskProject").value, $("taskDue").value);
      $("taskTitle").value = "";
      $("taskDue").value = "";
      $("taskDialog").close();
    });

    $("addTaskBtn").addEventListener("click", () => $("taskDialog").showModal());

    $("addProjectBtn").addEventListener("click", async () => {
      const project = prompt("Project name:");
      const clean = safeText(project);
      if (!clean || state.projects.includes(clean)) return;
      state.projects.push(clean);
      await saveState();
      renderAll();
    });

    $("searchInput").addEventListener("input", renderCaptures);

    $("clearAllBtn").addEventListener("click", async () => {
      if (!confirm("Delete all BrainDock captures and tasks from this device?")) return;
      state.captures = [];
      state.tasks = [];
      await saveState();
      renderAll();
    });

    $("backupBtn").addEventListener("click", exportBackup);

    $("restoreBtn").addEventListener("click", () => $("restoreFile").click());

    $("restoreFile").addEventListener("change", async (event) => {
      try {
        await restoreBackup(event.target.files?.[0]);
      } catch (error) {
        console.error(error);
        alert(error.message);
      } finally {
        event.target.value = "";
      }
    });

    document.addEventListener("click", async (event) => {
      const captureId = event.target.dataset.deleteCapture;
      if (captureId) {
        state.captures = state.captures.filter((item) => item.id !== captureId);
        await saveState();
        renderAll();
      }

      const taskCaptureId = event.target.dataset.taskFrom;
      if (taskCaptureId) {
        const capture = state.captures.find((item) => item.id === taskCaptureId);
        if (capture) {
          $("taskTitle").value = capture.title;
          $("taskProject").value = capture.project;
          $("taskDialog").showModal();
        }
      }

      const taskId = event.target.dataset.deleteTask;
      if (taskId) {
        state.tasks = state.tasks.filter((item) => item.id !== taskId);
        await saveState();
        renderAll();
      }
    });

    document.addEventListener("change", async (event) => {
      const taskId = event.target.dataset.toggleTask;
      if (taskId) {
        const task = state.tasks.find((item) => item.id === taskId);
        if (task) {
          task.done = event.target.checked;
          await saveState();
          renderAll();
        }
      }
    });

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      $("installBtn").classList.remove("hidden");
    });

    $("installBtn").addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      $("installBtn").classList.add("hidden");
    });
  }

  async function init() {
    if (!("indexedDB" in window)) {
      throw new Error("This browser does not support IndexedDB.");
    }

    await openDatabase();
    await loadState();
    bindEvents();
    renderAll();

    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("./sw.js").catch((error) => {
        console.warn("Service worker could not be registered:", error);
      });
    }
  }

  window.addEventListener("error", (event) => {
    $("fatalMessage").textContent = event.message || "Unknown startup error.";
    $("fatalError").classList.remove("hidden");
  });

  window.addEventListener("unhandledrejection", (event) => {
    $("fatalMessage").textContent = event.reason?.message || String(event.reason || "Unknown promise error.");
    $("fatalError").classList.remove("hidden");
  });

  init().catch((error) => {
    console.error(error);
    $("fatalMessage").textContent = error.message || String(error);
    $("fatalError").classList.remove("hidden");
  });
})();
