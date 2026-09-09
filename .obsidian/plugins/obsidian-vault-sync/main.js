"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => VaultSyncPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_node_child_process = require("node:child_process");
var import_node_fs = __toESM(require("node:fs"));
var import_node_os = __toESM(require("node:os"));
var import_node_path = __toESM(require("node:path"));
var DEFAULT_SETTINGS = {
  cliPath: "obsidian-vault-sync",
  sourceVault: ""
};
var VaultSyncPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
  }
  async onload() {
    await this.loadSettings();
    if (!this.settings.sourceVault) this.settings.sourceVault = this.currentVaultPath();
    this.addCommand({
      id: "run-sync-scan",
      name: "Run Vault Sync scan",
      callback: () => this.runScan()
    });
    this.addSettingTab(new VaultSyncSettingTab(this.app, this));
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await super.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  currentVaultPath() {
    var _a, _b;
    return ((_b = (_a = this.app.vault.adapter).getBasePath) == null ? void 0 : _b.call(_a)) || "";
  }
  saveGlobalConfig() {
    if (!this.settings.sourceVault) {
      new import_obsidian.Notice("\u8BF7\u5148\u8BBE\u7F6E\u914D\u7F6E\u6E90 Vault");
      return;
    }
    const dir = import_node_path.default.join(import_node_os.default.homedir(), "Library", "Application Support", "obsidian-vault-sync");
    import_node_fs.default.mkdirSync(dir, { recursive: true });
    import_node_fs.default.writeFileSync(import_node_path.default.join(dir, "config.json"), `${JSON.stringify({
      sourceVault: this.settings.sourceVault,
      backupRoot: "~/Library/Application Support/obsidian-vault-sync/backups",
      syncPluginSettings: true
    }, null, 2)}
`);
    new import_obsidian.Notice("\u5DF2\u4FDD\u5B58\u5168\u5C40\u540C\u6B65\u914D\u7F6E");
  }
  runScan() {
    const isNodeScript = this.settings.cliPath.endsWith(".mjs");
    const command = isNodeScript ? process.execPath : this.settings.cliPath;
    const args = isNodeScript ? [this.settings.cliPath, "scan"] : ["scan"];
    const child = (0, import_node_child_process.spawn)(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => new import_obsidian.Notice(`Vault Sync \u542F\u52A8\u5931\u8D25\uFF1A${error.message}`));
    child.on("close", (code) => {
      if (code === 0) new import_obsidian.Notice("Vault Sync \u626B\u63CF\u5B8C\u6210");
      else new import_obsidian.Notice(`Vault Sync \u626B\u63CF\u5931\u8D25\uFF1A${stderr || `\u9000\u51FA\u7801 ${code}`}`);
    });
  }
};
var VaultSyncSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Obsidian Vault Sync" });
    new import_obsidian.Setting(containerEl).setName("Source Vault").setDesc("\u5F53\u524D Vault \u9ED8\u8BA4\u4F5C\u4E3A\u914D\u7F6E\u6E90\uFF0C\u5176\u4ED6 Vault \u4F1A\u81EA\u52A8\u53D1\u73B0").addText((text) => text.setValue(this.plugin.settings.sourceVault).onChange(async (value) => {
      this.plugin.settings.sourceVault = value.trim();
      await this.plugin.saveSettings();
    })).addButton((button) => button.setButtonText("Use current").onClick(async () => {
      this.plugin.settings.sourceVault = this.plugin.currentVaultPath();
      await this.plugin.saveSettings();
      this.display();
    }));
    new import_obsidian.Setting(containerEl).setName("Save global config").setDesc("\u4FDD\u5B58\u5F53\u524D\u6E90 Vault\uFF0C\u4F9B macOS \u81EA\u52A8\u4EFB\u52A1\u4F7F\u7528").addButton((button) => button.setButtonText("Save").setCta().onClick(() => this.plugin.saveGlobalConfig()));
    new import_obsidian.Setting(containerEl).setName("CLI path").setDesc("obsidian-vault-sync \u53EF\u6267\u884C\u6587\u4EF6\u8DEF\u5F84\uFF1B\u9ED8\u8BA4\u4ECE PATH \u67E5\u627E").addText((text) => text.setPlaceholder("obsidian-vault-sync").setValue(this.plugin.settings.cliPath).onChange(async (value) => {
      this.plugin.settings.cliPath = value.trim() || DEFAULT_SETTINGS.cliPath;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Run scan").setDesc("\u7ACB\u5373\u6267\u884C\u4E00\u6B21\u4E3B Vault \u5230\u76EE\u6807 Vault \u7684\u63D2\u4EF6\u540C\u6B65").addButton((button) => button.setButtonText("Scan").setCta().onClick(() => this.plugin.runScan()));
  }
};
