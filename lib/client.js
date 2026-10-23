window.__ModuleLoader__.load({
	id: "@danenze/dsh-imagegeneration",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region locales
		/** English copy for the image-generation settings card. */
		const en = {
			title: "Image generation",
			description: "Call a text-to-image model and save the result as an image in the conversation.",
			baseUrl: "API endpoint",
			baseUrlHint: "DashScope-compatible base URL. Leave blank to use the built-in default.",
			model: "Model",
			modelHint: "The image model id, for example qwen-image-3.0-pro.",
			timeoutMs: "Timeout (ms)",
			timeoutMsHint: "How long one generation may run before it is abandoned.",
			apiKey: "API key",
			apiKeyHint: "Stored outside the settings file. Leave blank to keep the current key.",
			apiKeySet: "A key is configured.",
			apiKeyUnset: "No key is configured yet, so generation will fail.",
			overridden: "Overridden",
			reset: "Reset to default",
			readOnly: "This deployment stores settings read-only.",
			unavailable: "This plugin is not loaded, so it cannot be configured right now.",
			open: "Image generation",
			close: "Close",
			saved: "Up to date",
			save: "Save",
			saving: "Saving…",
			saveFailed: "The deployment did not accept these values; they were left for you to correct.",
			invalidNumber: "Enter a number, or leave blank to use the default.",
		};
		/** Simplified Chinese copy for the same card. */
		const zh = {
			title: "图片生成",
			description: "调用文生图模型，把结果保存成图片并显示在对话里。",
			baseUrl: "接口地址",
			baseUrlHint: "DashScope 兼容的地址；留空使用内置默认值。",
			model: "模型名",
			modelHint: "图片模型 id，例如 qwen-image-3.0-pro。",
			timeoutMs: "超时（毫秒）",
			timeoutMsHint: "单次生成最多等多久，超时即放弃。",
			apiKey: "API Key",
			apiKeyHint: "不写入设置文件。留空表示保持当前密钥。",
			apiKeySet: "已配置密钥。",
			apiKeyUnset: "尚未配置密钥，生成会失败。",
			overridden: "已覆盖",
			reset: "恢复默认",
			readOnly: "本部署的设置为只读。",
			unavailable: "该插件当前未加载，暂时无法配置。",
			open: "生成图片",
			close: "关闭",
			saved: "已是最新",
			save: "保存",
			saving: "保存中…",
			saveFailed: "本部署没有接受这些值，已保留供你修改。",
			invalidNumber: "请填数字；留空表示使用默认值。",
		};
		/**
		 * The form frame's copy, read from this page's dictionary.
		 * @param t - the page's locale reader.
		 * @returns the labels the shared settings form renders.
		 */
		function formLabels(t) {
			return {
				unavailable: t("unavailable"),
				readOnly: t("readOnly"),
				saveFailed: t("saveFailed"),
				save: t("save"),
				saving: t("saving"),
			};
		}
		//#endregion
		//#region card
		/**
		 * Render the image-generation card: its one-liner, or the settings form.
		 * @param props - the view asked for, the locale reader, the form snapshot, and its actions.
		 * @returns the one-liner, or the form.
		 */
		function ImagegenCard(props) {
			const { t } = props;
			const state = props.useImagegenCard((snapshot) => snapshot);
			if (props.view === "summary") return t("description");
			const disabled = !state.writable;
			return react_jsx_runtime.jsxs(primitives.SettingsForm, {
				labels: formLabels(t),
				state,
				onSave: props.save,
				onDiscard: props.discard,
				children: [
					react_jsx_runtime.jsx(primitives.SettingsValueField, {
						id: "plugin-config-imagegen-base-url",
						label: t("baseUrl"),
						hint: t("baseUrlHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalidNumber"),
						disabled,
						...state.baseURL,
						onEdit: (text) => {
							props.edit("baseURL", text);
						},
						onReset: () => {
							props.resetField("baseURL");
						},
					}),
					react_jsx_runtime.jsx(primitives.SettingsValueField, {
						id: "plugin-config-imagegen-model",
						label: t("model"),
						hint: t("modelHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalidNumber"),
						disabled,
						...state.model,
						onEdit: (text) => {
							props.edit("model", text);
						},
						onReset: () => {
							props.resetField("model");
						},
					}),
					react_jsx_runtime.jsx(primitives.SettingsValueField, {
						id: "plugin-config-imagegen-timeout",
						label: t("timeoutMs"),
						hint: t("timeoutMsHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalidNumber"),
						numeric: true,
						disabled,
						...state.timeoutMs,
						onEdit: (text) => {
							props.edit("timeoutMs", text);
						},
						onReset: () => {
							props.resetField("timeoutMs");
						},
					}),
					react_jsx_runtime.jsx(primitives.SettingsSecretField, {
						id: "plugin-config-imagegen-key",
						label: t("apiKey"),
						hint: t("apiKeyHint"),
						disabled: !state.apiKeyWritable,
						text: state.apiKey.text,
						configured: state.apiKeyConfigured,
						stateLabel: state.apiKeyConfigured ? t("apiKeySet") : t("apiKeyUnset"),
						onEdit: (text) => {
							props.edit("apiKey", text);
						},
					}),
				],
			});
		}
		//#endregion
		//#region controller
		/**
		 * The image-generation page's staged form over the `@danenze/dsh-imagegeneration`
		 * settings namespace.
		 *
		 * The key is the one control that does not live in the section: its literal
		 * never rides a response, so the page learns only whether one is configured
		 * and writes it through the credentials domain, addressed by the reference
		 * the section names.
		 */
		/** Namespace of this plugin's settings section — its Loader entry id. */
		const NS_PLUGIN = "@danenze/dsh-imagegeneration";
		/** Credential reference the plugin resolves when the section names none. */
		const DEFAULT_API_KEY_REF = "DASHSCOPE_API_KEY";
		/** Form field the credential control stages under. */
		const API_KEY_FIELD = "apiKey";
		/** Bridges the plugin's settings scope and the credentials domain onto the page. */
		var ImagegenCardController = class {
			scope;
			ctx;
			form;
			store;
			unsubscribe;
			credential = { ref: "", configured: false, writable: true };
			/**
			 * @param scope - the bound settings scope for this plugin's namespace.
			 * @param ctx - the page plugin's context, whose `remote.credentials` namespace
			 *   answers for the credential the section references.
			 */
			constructor(scope, ctx) {
				this.scope = scope;
				this.ctx = ctx;
				this.form = new primitives.SettingsFormModel(
					scope,
					[
						primitives.settingsTextField("baseURL"),
						primitives.settingsTextField("model"),
						primitives.settingsNumberField("timeoutMs"),
					],
					[{ field: API_KEY_FIELD, write: (text) => this.writeKey(text) }],
				);
				this.store = this.form.bind(() => this.projection());
				this.unsubscribe = scope.subscribe(() => {
					this.readCredential();
				});
				this.readCredential();
			}
			projection() {
				return {
					...this.form.shell(),
					baseURL: this.form.field("baseURL"),
					model: this.form.field("model"),
					timeoutMs: this.form.field("timeoutMs"),
					apiKey: this.form.field(API_KEY_FIELD),
					apiKeyConfigured: this.credential.configured,
					apiKeyWritable: this.credential.writable,
				};
			}
			/**
			 * Ask the credentials domain about the reference the section currently names.
			 *
			 * A response is published only while it still answers for the reference in
			 * force, because `apiKeyEnv` can change between the request and its answer.
			 */
			async readCredential() {
				const ref = refOf(this.scope.getSnapshot());
				if (ref !== this.credential.ref) {
					this.credential = { ref, configured: false, writable: true };
					this.store.set(this.projection());
				}
				const response = await this.ctx.remote.credentials.describe([ref]);
				if (!response.ok || ref !== refOf(this.scope.getSnapshot())) return;
				const view = response.value[ref];
				const next = {
					ref,
					configured: (view && view.configured) || false,
					writable: view && view.writable !== void 0 ? view.writable : true,
				};
				if (next.configured === this.credential.configured && next.writable === this.credential.writable) return;
				this.credential = next;
				this.store.set(this.projection());
			}
			/**
			 * Re-read after the Host reports a change to the reference this page watches.
			 * @param ref - the reference the Host reports as changed.
			 */
			refreshCredential(ref) {
				if (ref !== this.credential.ref) return;
				this.readCredential();
			}
			/**
			 * Build the face the page's slot registration injects.
			 * @returns the page's snapshot and its form actions.
			 */
			inject() {
				return {
					hooks: { imagegenCard: this.store },
					...this.form.actions(),
				};
			}
			/**
			 * Write the staged key, then re-read whether the Host now holds one.
			 * @param value - the staged credential literal.
			 * @returns whether the Host reports a configured credential afterwards.
			 */
			async writeKey(value) {
				await this.ctx.remote.credentials.set(refOf(this.scope.getSnapshot()), value);
				await this.readCredential();
				return this.credential.configured;
			}
			/** Release configuration subscriptions. */
			dispose() {
				this.unsubscribe();
				this.form.dispose();
			}
		};
		/**
		 * The credential reference the section names, or the plugin's default.
		 * @param snapshot - the current scope snapshot.
		 * @returns the reference to address.
		 */
		function refOf(snapshot) {
			const declared = snapshot.value && snapshot.value.apiKeyEnv;
			return declared !== void 0 && declared.length > 0 ? declared : DEFAULT_API_KEY_REF;
		}
		//#endregion
		//#region composer
		/**
		 * Styles for the composer button and its popover.
		 *
		 * Owned by this plugin only (the `data-plugin` marker below), and built from
		 * the theme's alias tokens so the button follows light and dark themes.
		 */
		const COMPOSER_CSS = [
			'.img-trigger{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;cursor:pointer;color:var(--dsw-alias-label-secondary);background:transparent;border:none;line-height:1;outline:none;transition:background .12s,color .12s}',
			'.img-trigger:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
			'.img-trigger.on{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}',
			'.img-pop{position:absolute;bottom:calc(100% + 8px);left:0;box-sizing:border-box;width:min(320px,92vw);z-index:30;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);display:flex;flex-direction:column;gap:10px;padding:14px;font-size:12px;color:var(--dsw-alias-label-primary)}',
			'.img-pop .ip-title{font-size:13px;font-weight:600;line-height:1.2}',
			'.img-pop label{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
			'.img-pop input{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 9px;font-size:12px;outline:none;transition:border-color .12s ease}',
			'.img-pop input:focus{border-color:var(--dsw-alias-brand-primary)}',
			'.img-pop input:disabled{opacity:.6}',
			'.img-pop .ip-note{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.45}',
			'.img-pop .ip-note.warn{color:var(--dsw-alias-label-warn,var(--dsw-alias-brand-primary))}',
			'.img-pop .ip-foot{display:flex;align-items:center;gap:8px}',
			'.img-pop .ip-grow{flex:1 1 auto;min-width:0}',
			'.img-pop button{border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);transition:border-color .12s ease}',
			'.img-pop button:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}',
			'.img-pop button.primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
			'.img-pop button:disabled{opacity:.5;cursor:default}',
		].join('');
		/**
		 * Attach this plugin's stylesheet, marked so its owner can find it again.
		 * @param css - the rules to attach.
		 * @returns the style element, or undefined when there is no document.
		 */
		function attachStyle(css) {
			if (typeof document === 'undefined' || !document.head) return undefined;
			const el = document.createElement('style');
			el.setAttribute('data-plugin', NS_PLUGIN);
			el.textContent = css;
			document.head.appendChild(el);
			return el;
		}
		/**
		 * Build the popover's open/closed switch as a snapshot source, so the button
		 * and the panel read the same value through `useSyncExternalStore`.
		 * @returns the switch.
		 */
		function createToggle() {
			let open = false;
			const listeners = new Set();
			const emit = () => {
				for (const fn of [...listeners]) fn();
			};
			return {
				getSnapshot: () => open,
				subscribe: (fn) => {
					listeners.add(fn);
					return () => {
						listeners.delete(fn);
					};
				},
				set: (value) => {
					if (value === open) return;
					open = value;
					emit();
				},
				toggle: () => {
					open = !open;
					emit();
				},
			};
		}
		/**
		 * Build the composer button.
		 *
		 * The component is hoisted out of the slot's render callback on purpose: a
		 * fresh component function per render would remount the button on every
		 * streaming update of the surrounding composer.
		 * @param toggle - the popover switch.
		 * @param t - the page's locale reader.
		 * @returns the button component.
		 */
		function makeImageButton(toggle, t) {
			return function ImageButton() {
				const open = React.useSyncExternalStore(toggle.subscribe, toggle.getSnapshot);
				return react_jsx_runtime.jsx("button", {
					type: "button",
					className: open ? "img-trigger on" : "img-trigger",
					title: t("open"),
					"aria-label": t("open"),
					"aria-expanded": open,
					onClick: (event) => {
						event.preventDefault();
						event.stopPropagation();
						toggle.toggle();
					},
					children: react_jsx_runtime.jsx("svg", {
						viewBox: "0 0 24 24",
						width: 20,
						height: 20,
						style: { display: "block" },
						children: react_jsx_runtime.jsx("path", {
							d: "M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z",
							fill: "currentColor",
						}),
					}),
				});
			};
		}
		/**
		 * Build the composer popover: the endpoint, the model id, and the write-only
		 * key, over the same staged form the Plugins page card uses.
		 *
		 * The key literal is never seeded from a response — the panel learns only
		 * whether one is configured, and a blank draft writes nothing.
		 * @param store - the published form projection.
		 * @param form - the staged form whose actions the controls call.
		 * @param toggle - the popover switch.
		 * @param t - the page's locale reader.
		 * @returns the panel component.
		 */
		function makeImagePanel(store, form, toggle, t) {
			const actions = form.actions();
			return function ImagePanel() {
				const open = React.useSyncExternalStore(toggle.subscribe, toggle.getSnapshot);
				const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot);
				React.useEffect(() => {
					if (!open) return undefined;
					const onDown = (event) => {
						const target = event.target;
						if (target && typeof target.closest === "function" && (target.closest(".img-pop") || target.closest(".img-trigger"))) return;
						toggle.set(false);
					};
					document.addEventListener("pointerdown", onDown, true);
					return () => {
						document.removeEventListener("pointerdown", onDown, true);
					};
				}, [open]);
				if (!open) return null;
				if (!state.available) return react_jsx_runtime.jsx("div", { className: "img-pop", children: t("unavailable") });
				const disabled = !state.writable || state.saving;
				const note = !state.writable ? t("readOnly") : state.failed ? t("saveFailed") : state.apiKeyConfigured ? t("apiKeySet") : t("apiKeyUnset");
				return react_jsx_runtime.jsxs("div", {
					className: "img-pop",
					children: [
						react_jsx_runtime.jsx("div", { className: "ip-title", children: t("title") }),
						react_jsx_runtime.jsx("label", {
							children: [
								t("baseUrl"),
								react_jsx_runtime.jsx("input", {
									type: "text",
									value: state.baseURL.text,
									placeholder: "https://dashscope.aliyuncs.com",
									disabled,
									onChange: (event) => {
										actions.edit("baseURL", event.target.value);
									},
								}),
							],
						}),
						react_jsx_runtime.jsx("label", {
							children: [
								t("model"),
								react_jsx_runtime.jsx("input", {
									type: "text",
									value: state.model.text,
									placeholder: "qwen-image-3.0",
									disabled,
									onChange: (event) => {
										actions.edit("model", event.target.value);
									},
								}),
							],
						}),
						react_jsx_runtime.jsx("label", {
							children: [
								t("apiKey"),
								react_jsx_runtime.jsx("input", {
									type: "password",
									value: state.apiKey.text,
									placeholder: state.apiKeyConfigured ? t("apiKeySet") : t("apiKeyUnset"),
									disabled,
									onChange: (event) => {
										actions.edit("apiKey", event.target.value);
									},
								}),
							],
						}),
						react_jsx_runtime.jsx("div", { className: state.failed ? "ip-note warn" : "ip-note", children: note }),
						react_jsx_runtime.jsxs("div", {
							className: "ip-foot",
							children: [
								react_jsx_runtime.jsx("button", {
									type: "button",
									onClick: () => {
										toggle.set(false);
									},
									children: t("close"),
								}),
								react_jsx_runtime.jsx("button", {
									type: "button",
									className: "primary",
									disabled: disabled || state.invalid || !state.dirty,
									onClick: () => {
										actions.save();
									},
									children: state.saving ? t("saving") : t("save"),
								}),
							],
						}),
					],
				});
			};
		}
		//#endregion
		//#region plugin
		/**
		 * The image-generation plugin's settings card in the browser: the API
		 * endpoint, the model id, the timeout, and the write-only key. It registers
		 * into the Plugins page's `plugins.item` slot while the Host serves this
		 * plugin's namespace, so an unloaded plugin shows no trace of it.
		 */
		/** Dictionary namespace owned by this plugin. */
		const NS = "settings.imagegen";
		/** Required services (cordis fiber inject). */
		const inject = ["slots", "locale", "remote", "remote.credentials", "configForms"];
		/**
		 * Mount the image-generation settings card.
		 * @param ctx - the browser plugin context.
		 */
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "imagegen: dictionaries");
			const card = new ImagegenCardController(ctx.configForms.get(NS_PLUGIN), ctx);
			ctx.effect(
				() => () => {
					card.dispose();
				},
				"imagegen: form subscription",
			);
			ctx.effect(
				() =>
					ctx.remote.$on("credentials/reference-updated", (ref) => {
						card.refreshCredential(ref);
					}),
				"imagegen: credential invalidations",
			);
			ctx.effect(
				() =>
					ctx.configForms.whileServed([NS_PLUGIN], () =>
						ctx.slots.inject("plugins.item", () =>
							ctx.slots.register(
								{
									name: "plugins.item",
									id: "imagegen",
									order: 45,
									label: () => t("title"),
									locale: NS,
									inject: () => card.inject(),
								},
								ImagegenCard,
							),
						),
					),
				"imagegen: page",
			);
			// The composer button: one click opens the endpoint/model/key panel, so the
			// plugin can be pointed at another provider without leaving the conversation.
			const toggle = createToggle();
			const ComposerButton = makeImageButton(toggle, t);
			const ComposerPanel = makeImagePanel(card.store, card.form, toggle, t);
			ctx.effect(() => {
				const style = attachStyle(COMPOSER_CSS);
				return () => {
					if (style && style.parentNode) style.parentNode.removeChild(style);
				};
			}, "imagegen: composer styles");
			ctx.effect(
				() =>
					ctx.slots.inject("conversation.input.left", () =>
						ctx.slots.register(
							{
								name: "conversation.input.left",
								id: "imagegen",
								order: 6,
								label: () => t("open"),
								locale: NS,
							},
							(props) => react_jsx_runtime.jsx(ComposerButton, props ?? {}),
						),
					),
				"imagegen: composer button",
			);
			ctx.effect(
				() =>
					ctx.slots.inject("conversation.input.overlay", () =>
						ctx.slots.register(
							{
								name: "conversation.input.overlay",
								id: "imagegen",
								order: 6,
								label: () => t("open"),
								locale: NS,
							},
							(props) => react_jsx_runtime.jsx(ComposerPanel, props ?? {}),
						),
					),
				"imagegen: composer panel",
			);
		}
		//#endregion
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
//# sourceMappingURL=client.js.map
