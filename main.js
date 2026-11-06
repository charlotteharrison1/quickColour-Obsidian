const { Plugin, PluginSettingTab, Setting, ColorComponent, editorLivePreviewField } = require("obsidian");
const { RangeSetBuilder } = require("@codemirror/state");
const { Decoration, ViewPlugin } = require("@codemirror/view");

const DEFAULT_SETTINGS = {
	rules: [
		{ key: "p", color: "#fdd3e8", dark: "#643a4e" },
		{ key: "b", color: "#d6edff", dark: "#3a4c59" },
		{ key: "g", color: "#d6ffd1", dark: "#42603e" },
		{ key: "o", color: "#ffe8d1", dark: "#7f5b39" },
	],
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Inline CSS vars for a rule; --qch-dark only when a dark colour is set
// Default dark colour (used when none is picked): light colour at 55% over the dark background.
// ponytail: assumes the default dark background #1e1e1e; custom themes may differ slightly.
const autoDark = (hex) => {
	const bg = [0x1e, 0x1e, 0x1e];
	return "#" + [1, 3, 5].map((p, i) =>
		Math.round(parseInt(hex.slice(p, p + 2), 16) * 0.55 + bg[i] * 0.45).toString(16).padStart(2, "0")
	).join("");
};

const colorVars = (r) => `--qch-color: ${r.color}; --qch-dark: ${r.dark ?? autoDark(r.color)}`;

module.exports = class QuickColorHighlights extends Plugin {
	async onload() {
		this.settings = Object.assign({}, structuredClone(DEFAULT_SETTINGS), await this.loadData());
		this.addSettingTab(new QCHSettingTab(this.app, this));

		// Reading view: <mark>p text</mark> -> pink <mark>text</mark>
		this.registerMarkdownPostProcessor((el) => {
			el.querySelectorAll("mark").forEach((m) => this.colorMark(m));
		});

		// Live Preview / Source mode
		const plugin = this;
		this.registerEditorExtension(
			ViewPlugin.fromClass(
				class {
					constructor(view) {
						this.decorations = plugin.buildDecorations(view);
					}
					update(u) {
						if (u.docChanged || u.viewportChanged || u.selectionSet || u.transactions.some((t) => t.reconfigured)) {
							this.decorations = plugin.buildDecorations(u.view);
						}
					}
				},
				{ decorations: (v) => v.decorations }
			)
		);
	}

	activeRules() {
		return this.settings.rules.filter((r) => r.key.length > 0);
	}

	colorMark(mark) {
		const first = mark.firstChild;
		if (!first || first.nodeType !== Node.TEXT_NODE) return;
		const text = first.textContent ?? "";
		const rule = this.activeRules().find((r) => text.startsWith(r.key + " "));
		if (!rule) return;
		first.textContent = text.slice(rule.key.length + 1);
		mark.addClass("qch-mark");
		mark.style.cssText = colorVars(rule);
	}

	buildDecorations(view) {
		const builder = new RangeSetBuilder();
		const rules = this.activeRules();
		if (!rules.length) return builder.finish();

		const re = new RegExp(`==(${rules.map((r) => escapeRegex(r.key)).join("|")}) ([^=\\n]+?)==`, "g");
		const sel = view.state.selection.main;
		const livePreview = view.state.field(editorLivePreviewField, false) ?? false;

		for (const { from, to } of view.visibleRanges) {
			const text = view.state.doc.sliceString(from, to);
			let m;
			while ((m = re.exec(text))) {
				const start = from + m.index;
				const end = start + m[0].length;
				const rule = rules.find((r) => r.key === m[1]);
				const prefixFrom = start + 2; // after "=="
				const prefixTo = prefixFrom + rule.key.length + 1; // key + space

				builder.add(start, end, Decoration.mark({
					class: "qch-mark",
					attributes: { style: colorVars(rule) },
				}));
				// Hide the "p " prefix in Live Preview unless the cursor is in this highlight
				if (livePreview && !(sel.from <= end && sel.to >= start)) {
					builder.add(prefixFrom, prefixTo, Decoration.replace({}));
				}
			}
		}
		return builder.finish();
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.app.workspace.updateOptions(); // refresh open editors
	}
};

class QCHSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("p", {
			text: "Type ==key your text== to get a coloured highlight, e.g. ==p like this==. Keys must not contain spaces.",
		});

		this.plugin.settings.rules.forEach((rule, i) => {
			const row = new Setting(containerEl)
				.setName(`Colour ${i + 1}`)
				.addText((t) => t.setPlaceholder("key, e.g. p").setValue(rule.key).onChange(async (v) => {
					rule.key = v.trim();
					await this.plugin.saveSettings();
				}));

			const picker = (label) => new ColorComponent(row.controlEl.createEl("label", { cls: "qch-picker", text: label }));
			const light = picker("Light").setValue(rule.color);
			const dark = picker("Dark").setValue(rule.dark ?? autoDark(rule.color));

			light.onChange(async (v) => {
				rule.color = v;
				if (!rule.dark) dark.setValue(autoDark(v)); // keep the calculated dark colour in step
				await this.plugin.saveSettings();
			});
			dark.onChange(async (v) => {
				rule.dark = v;
				await this.plugin.saveSettings();
			});

			row
				.addExtraButton((b) => b.setIcon("rotate-ccw").setTooltip("Reset dark colour to default").onClick(async () => {
					delete rule.dark;
					dark.setValue(autoDark(rule.color));
					await this.plugin.saveSettings();
				}))
				.addExtraButton((b) => b.setIcon("trash").setTooltip("Remove").onClick(async () => {
					this.plugin.settings.rules.splice(i, 1);
					await this.plugin.saveSettings();
					this.display();
				}));
		});

		new Setting(containerEl).addButton((b) => b.setButtonText("Add colour").setCta().onClick(async () => {
			this.plugin.settings.rules.push({ key: "", color: "#ffb3d9" });
			await this.plugin.saveSettings();
			this.display();
		}));
	}
}
