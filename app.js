
(() => {
  "use strict";

  const DB_NAME = "BrainDockDB";
  const DB_VERSION = 1;
  const STORE_NAME = "appState";
  const STATE_KEY = "main";
  const DEFAULT_PROJECTS = ["Work", "Tallgrass", "School", "Personal", "Finance", "Ideas"];

  let db;
  let state = { projects: [...DEFAULT_PROJECTS], captures: [], tasks: [] };
  let recorder = null;
  let recordingStream = null;
  let chunks = [];
  let pendingAudioBlob = null;
  let timerInterval = null;
  let recordingStartedAt = 0;
  let deferredInstallPrompt = null;

  const $ = (id) => document.getElementById(id);

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDate(value) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(new Date(value));
    } catch {
      return "";
    }
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        db = request.result;
        resolve();
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Close other BrainDock tabs and reload."));
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
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Database write failed."));
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
    $("storageStatus").textContent =
      `${state.captures.length} capture${state.captures.length === 1 ? "" : "s"} and ` +
      `${state.tasks.length} task${state.tasks.length === 1 ? "" : "s"} stored on this device`;
  }

  function populateProjects() {
    ["projectSelect", "recordingProject", "taskProject"].forEach((id) => {
      const select = $(id);
      const previous = select.value;
      select.innerHTML = state.projects
        .map(project => `<option value="${escapeHtml(project)}">${escapeHtml(project)}</option>`)
        .join("");
      if (state.projects.includes(previous)) select.value = previous;
    });
  }

  function captureCard(capture) {
    const audio = capture.audioDataUrl
      ? `<audio controls preload="metadata" src="${escapeHtml(capture.audioDataUrl)}"></audio>`
      : "";
    return `<article class="item">
      <h3>${escapeHtml(capture.title)}</h3>
      ${capture.text ? `<p>${escapeHtml(capture.text)}</p>` : ""}
      ${audio}
      <div class="meta">
        <span class="badge">${escapeHtml(capture.project)}</span>
        <span>${formatDate(capture.createdAt)}</span>
        <span>${escapeHtml(capture.kind)}</span>
      </div>
      <div class="item-actions">
        <button type="button" data-task-from="${capture.id}">Make task</button>
        <button type="button" data-delete-capture="${capture.id}">Delete</button>
      </div>
    </article>`;
  }

  function renderCaptures() {
    const query = $("searchInput").value.trim().toLowerCase();
    const captures = [...state.captures]
      .filter(item => !query || [item.title, item.text, item.project]
        .some(value => String(value || "").toLowerCase().includes(query)))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    $("recentList").innerHTML = captures.length
      ? captures.slice(0, 5).map(captureCard).join("")
      : `<div class="empty">Nothing captured yet.</div>`;

    $("inboxList").innerHTML = captures.length
      ? captures.map(captureCard).join("")
      : `<div class="empty">Your inbox is empty.</div>`;
  }

  function renderTasks() {
    const tasks = [...state.tasks].sort((a, b) => Number(a.done) - Number(b.done));
    $("taskList").innerHTML = tasks.length ? tasks.map(task => `
      <article class="item task-row ${task.done ? "done" : ""}">
        <input type="checkbox" data-toggle-task="${task.id}" ${task.done ? "checked" : ""}>
        <div>
          <h3>${escapeHtml(task.title)}</h3>
          <div class="meta">
            <span class="badge">${escapeHtml(task.project)}</span>
            ${task.due ? `<span>Due ${escapeHtml(task.due)}</span>` : ""}
          </div>
          <div class="item-actions">
            <button type="button" data-delete-task="${task.id}">Delete</button>
          </div>
        </div>
      </article>`).join("") : `<div class="empty">No tasks yet.</div>`;
  }

  function renderProjects() {
    $("projectList").innerHTML = state.projects.map(project => {
      const captures = state.captures.filter(item => item.project === project).length;
      const tasks = state.tasks.filter(item => item.project === project && !item.done).length;
      return `<article class="project-card">
        <h3>${escapeHtml(project)}</h3>
        <p>${captures} captures · ${tasks} open tasks</p>
      </article>`;
    }).join("");
  }

  function renderAll() {
    populateProjects();
    renderCaptures();
    renderTasks();
    renderProjects();
    updateStorageStatus();
  }

  function switchScreen(screenId) {
    document.querySelectorAll(".screen").forEach(screen => {
      screen.classList.toggle("active", screen.id === screenId);
    });
    document.querySelectorAll(".tab").forEach(tab => {
      tab.classList.toggle("active", tab.dataset.screen === screenId);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function addCapture(data) {
    state.captures.push({
      id: uid(),
      title: data.title.trim() || "Untitled capture",
      text: data.text?.trim() || "",
      project: data.project || state.projects[0],
      kind: data.kind || "note",
      audioDataUrl: data.audioDataUrl || "",
      createdAt: new Date().toISOString()
    });
    await saveState();
    renderAll();
  }

  async function addTask(title, project, due = "") {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    state.tasks.push({
      id: uid(),
      title: cleanTitle,
      project: project || state.projects[0],
      due,
      done: false,
      createdAt: new Date().toISOString()
    });
    await saveState();
    renderAll();
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("This browser does not support audio recording.");
    }
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const supportedType = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]
      .find(type => MediaRecorder.isTypeSupported?.(type));

    recorder = supportedType
      ? new MediaRecorder(recordingStream, { mimeType: supportedType })
      : new MediaRecorder(recordingStream);

    chunks = [];
    recorder.ondataavailable = event => {
      if (event.data?.size) chunks.push(event.data);
    };
    recorder.onstop = () => {
      pendingAudioBlob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      $("playback").src = URL.createObjectURL(pendingAudioBlob);
      $("playback").classList.remove("hidden");
      $("recordingTitle").value = `Voice note ${new Date().toLocaleString()}`;
      $("recordingDialog").showModal();
      recordingStream?.getTracks().forEach(track => track.stop());
      recordingStream = null;
    };

    recorder.start();
    recordingStartedAt = Date.now();
    $("recordBtn").classList.add("recording");
    $("recordStatus").textContent = "Recording… tap to stop";
    updateTimer();
    timerInterval = setInterval(updateTimer, 250);
  }

  function stopRecording() {
    if (recorder?.state === "recording") recorder.stop();
    clearInterval(timerInterval);
    timerInterval = null;
    $("recordBtn").classList.remove("recording");
    $("recordStatus").textContent = "Tap to record";
  }

  function updateTimer() {
    const totalSeconds = Math.floor((Date.now() - recordingStartedAt) / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    $("timer").textContent = `${minutes}:${seconds}`;
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
      version: 1,
      exportedAt: new Date().toISOString(),
      state
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const filename = `BrainDock-Backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const file = new File([blob], filename, { type: "application/json" });

    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: "BrainDock Backup",
          text: "Save this backup to iCloud Drive.",
          files: [file]
        });
        return;
      }
    } catch (error) {
      if (error.name === "AbortError") return;
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
      throw new Error("That is not a valid BrainDock backup file.");
    }

    const imported = parsed.state || parsed;
    if (!Array.isArray(imported.projects) ||
        !Array.isArray(imported.captures) ||
        !Array.isArray(imported.tasks)) {
      throw new Error("That file does not contain compatible BrainDock data.");
    }

    if (!confirm(
      `Replace this device's data with ${imported.captures.length} captures and ${imported.tasks.length} tasks?`
    )) return;

    state = imported;
    await saveState();
    renderAll();
    alert("Backup restored.");
  }

  function showFatal(error) {
    console.error(error);
    $("fatalMessage").textContent = error?.message || String(error);
    $("fatalError").classList.remove("hidden");
  }

  function bindEvents() {
    document.querySelectorAll(".tab").forEach(tab => {
      tab.addEventListener("click", () => switchScreen(tab.dataset.screen));
    });

    $("recordBtn").addEventListener("click", async () => {
      try {
        if (recorder?.state === "recording") stopRecording();
        else await startRecording();
      } catch (error) {
        alert(`${error.message} Check microphone permission and make sure the site uses HTTPS.`);
      }
    });

    $("saveNoteBtn").addEventListener("click", async () => {
      const text = $("quickNote").value.trim();
      if (!text) return;
      await addCapture({
        title: text.length > 64 ? `${text.slice(0, 61)}…` : text,
        text,
        project: $("projectSelect").value,
        kind: "note"
      });
      $("quickNote").value = "";
    });

    $("recordingForm").addEventListener("submit", async event => {
      event.preventDefault();
      if (!pendingAudioBlob) return;
      const audioDataUrl = await blobToDataUrl(pendingAudioBlob);
      await addCapture({
        title: $("recordingTitle").value,
        project: $("recordingProject").value,
        kind: "recording",
        audioDataUrl
      });
      pendingAudioBlob = null;
      $("playback").classList.add("hidden");
      $("playback").removeAttribute("src");
      $("timer").textContent = "00:00";
      $("recordingDialog").close();
    });

    $("cancelRecordingBtn").addEventListener("click", () => {
      pendingAudioBlob = null;
      $("playback").classList.add("hidden");
      $("playback").removeAttribute("src");
      $("timer").textContent = "00:00";
      $("recordingDialog").close();
    });

    $("taskForm").addEventListener("submit", async event => {
      event.preventDefault();
      await addTask($("taskTitle").value, $("taskProject").value, $("taskDue").value);
      $("taskTitle").value = "";
      $("taskDue").value = "";
      $("taskDialog").close();
    });

    $("cancelTaskBtn").addEventListener("click", () => $("taskDialog").close());
    $("addTaskBtn").addEventListener("click", () => $("taskDialog").showModal());

    $("addProjectBtn").addEventListener("click", async () => {
      const value = prompt("Project name:");
      const project = value?.trim();
      if (!project || state.projects.includes(project)) return;
      state.projects.push(project);
      await saveState();
      renderAll();
    });

    $("searchInput").addEventListener("input", renderCaptures);

    $("clearAllBtn").addEventListener("click", async () => {
      if (!confirm("Delete every capture and task from this device?")) return;
      state.captures = [];
      state.tasks = [];
      await saveState();
      renderAll();
    });

    $("backupBtn").addEventListener("click", () => {
      exportBackup().catch(showFatal);
    });

    $("restoreBtn").addEventListener("click", () => $("restoreFile").click());

    $("restoreFile").addEventListener("change", event => {
      restoreBackup(event.target.files?.[0])
        .catch(error => alert(error.message))
        .finally(() => { event.target.value = ""; });
    });

    $("reloadBtn").addEventListener("click", () => location.reload());

    document.addEventListener("click", async event => {
      const captureId = event.target.dataset.deleteCapture;
      if (captureId) {
        state.captures = state.captures.filter(item => item.id !== captureId);
        await saveState();
        renderAll();
      }

      const sourceId = event.target.dataset.taskFrom;
      if (sourceId) {
        const capture = state.captures.find(item => item.id === sourceId);
        if (capture) {
          $("taskTitle").value = capture.title;
          $("taskProject").value = capture.project;
          $("taskDialog").showModal();
        }
      }

      const taskId = event.target.dataset.deleteTask;
      if (taskId) {
        state.tasks = state.tasks.filter(item => item.id !== taskId);
        await saveState();
        renderAll();
      }
    });

    document.addEventListener("change", async event => {
      const taskId = event.target.dataset.toggleTask;
      if (!taskId) return;
      const task = state.tasks.find(item => item.id === taskId);
      if (task) {
        task.done = event.target.checked;
        await saveState();
        renderAll();
      }
    });

    window.addEventListener("beforeinstallprompt", event => {
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

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(console.warn);
    }
  }

  window.addEventListener("error", event => showFatal(event.error || new Error(event.message)));
  window.addEventListener("unhandledrejection", event => showFatal(event.reason));

  init().catch(showFatal);
})();
