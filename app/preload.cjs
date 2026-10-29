// ============================================================================
//  Puente seguro entre la UI y el proceso principal
// ============================================================================

const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getPrefs: () => ipcRenderer.invoke("prefs:get"),
  setPrefs: (patch) => ipcRenderer.invoke("prefs:set", patch),
  platform: process.platform,

  openProject: () => ipcRenderer.invoke("project:open"),
  info: () => ipcRenderer.invoke("project:info"),
  documentThemes: () => ipcRenderer.invoke("project:themes"),
  selectDocumentTheme: (id) => ipcRenderer.invoke("project:theme-select", id),
  createDocumentTheme: (name) => ipcRenderer.invoke("project:theme-create", name),
  deleteDocumentTheme: (id, confirmation) => ipcRenderer.invoke("project:theme-delete", id, confirmation),

  outline: (file) => ipcRenderer.invoke("project:outline", file),

  listDir: (rel) => ipcRenderer.invoke("fs:list", rel),
  createFile: (rel) => ipcRenderer.invoke("fs:createFile", rel),
  createFolder: (rel) => ipcRenderer.invoke("fs:createFolder", rel),
  importFiles: (rel) => ipcRenderer.invoke("fs:import", rel),
  importPaths: (paths, rel) => ipcRenderer.invoke("fs:importPaths", paths, rel),
  pathForFile: (file) => webUtils.getPathForFile(file),
  deletePath: (rel) => ipcRenderer.invoke("fs:delete", rel),
  openFolder: (rel) => ipcRenderer.invoke("fs:openFolder", rel),

  readFile: (rel) => ipcRenderer.invoke("file:read", rel),
  writeFile: (rel, content) => ipcRenderer.invoke("file:write", rel, content),

  compile: (file) => ipcRenderer.invoke("preview:compile", file),
  blocks: () => ipcRenderer.invoke("preview:blocks"),
  words: (range = null) => ipcRenderer.invoke("preview:words", range),
  renderDoc: (rel) => ipcRenderer.invoke("doc:render", rel),

  listAssets: () => ipcRenderer.invoke("assets:list"),
  assetThumb: (rel) => ipcRenderer.invoke("assets:thumb", rel),
  loadImage: (rel) => ipcRenderer.invoke("image:load", rel),
  pickImage: () => ipcRenderer.invoke("image:pick"),
  saveImageEdit: (rel, edit) => ipcRenderer.invoke("image:save", rel, edit),
  exportPdf: (file) => ipcRenderer.invoke("pdf:export", file),
  exportHtml: () => ipcRenderer.invoke("export:html"),
  exportDocx: () => ipcRenderer.invoke("export:docx"),
  openPath: (target) => ipcRenderer.invoke("app:openPath", target),
  showItem: (target) => ipcRenderer.invoke("app:showItem", target),

  gitStatus: () => ipcRenderer.invoke("git:status"),
  gitDiff: (file, staged) => ipcRenderer.invoke("git:diff", file, staged),
  gitAdd: (file) => ipcRenderer.invoke("git:add", file),
  gitUnstage: (file) => ipcRenderer.invoke("git:unstage", file),
  gitCommit: (message) => ipcRenderer.invoke("git:commit", message),
  gitLog: () => ipcRenderer.invoke("git:log"),
  gitBranches: () => ipcRenderer.invoke("git:branches"),
  gitCheckout: (branch) => ipcRenderer.invoke("git:checkout", branch),

  runCommand: (command) => ipcRenderer.invoke("cmd:run", command),

  search: (query) => ipcRenderer.invoke("search:query", query),
  replaceAll: (query, replacement) => ipcRenderer.invoke("search:replace", query, replacement),
  formulaPreview: (latex, display) => ipcRenderer.invoke("formula:preview", latex, display),

  copyText: (text) => ipcRenderer.invoke("clipboard:write", text),
  edit: (action) => ipcRenderer.invoke("app:edit", action),
  quit: () => ipcRenderer.invoke("app:quit"),
  about: () => ipcRenderer.invoke("app:about"),
  toggleDevTools: () => ipcRenderer.invoke("app:toggleDevTools"),

  termShells: () => ipcRenderer.invoke("term:shells"),
  termStart: (id, cols, rows, shellId) => ipcRenderer.invoke("term:start", id, cols, rows, shellId),
  termRestart: (id, cols, rows, shellId) => ipcRenderer.invoke("term:restart", id, cols, rows, shellId),
  termClose: (id) => ipcRenderer.invoke("term:close", id),
  termInput: (id, data) => ipcRenderer.send("term:input", id, data),
  termResize: (id, cols, rows) => ipcRenderer.send("term:resize", id, cols, rows),
  onTermData: (callback) => {
    ipcRenderer.on("term:data", (_event, payload) => callback(payload));
  },
  onTermExit: (callback) => {
    ipcRenderer.on("term:exit", (_event, payload) => callback(payload));
  },

  onFsChanged: (callback) => {
    ipcRenderer.on("fs:changed", () => callback());
  },
  onMenuAction: (callback) => {
    ipcRenderer.on("menu:action", (_event, action) => callback(action));
  },
});
