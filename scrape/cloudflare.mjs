export async function cfCheck(page) {
    try {
        await page.waitForFunction(() => window._cf_chl_opt === undefined);
        for (const frame of page.frames()) {
            try {
                const frameUrl = frame.url();
                const domain = new URL(frameUrl).hostname;
                if (domain === "challenges.cloudflare.com") {
                    const widgetId = await frame.evaluate(() => window._cf_chl_opt?.chlApiWidgetId);
                    if (!widgetId)
                        continue;
                    const widgetSelector = `cf-chl-widget-${widgetId}_response`;
                    await page.waitForFunction((selector) => {
                        const element = document.getElementById(selector);
                        return element instanceof HTMLInputElement && element.value !== "";
                    }, {}, widgetSelector);
                    await page.evaluate((selector) => {
                        const element = document.getElementById(selector);
                        return element instanceof HTMLInputElement ? element.value : null;
                    }, widgetSelector);
                }
            }
            catch (error) {
                console.error(`Error processing frame: ${error.message}`);
            }
        }
    }
    catch (error) {
        console.error(`Error in cfCheck: ${error.message}`);
    }
}
export function preload() {
    const patchWindow = (w) => {
        if (!w)
            return;
        w.chrome = {
            app: {
                isInstalled: false,
                InstallState: {
                    DISABLED: "disabled",
                    INSTALLED: "installed",
                    NOT_INSTALLED: "not_installed",
                },
                RunningState: {
                    CANNOT_RUN: "cannot_run",
                    READY_TO_RUN: "ready_to_run",
                    RUNNING: "running",
                },
            },
            loadTimes: () => { },
            csi: () => { },
        };
        const noOp = () => { };
        w.console.debug = noOp;
        w.console.log = noOp;
        w.console.context = noOp;
        const originalPermissionsQuery = w.navigator.permissions.query;
        w.navigator.permissions.query = new Proxy(originalPermissionsQuery, {
            apply: async (target, thisArg, args) => {
                try {
                    const result = await Reflect.apply(target, thisArg, args);
                    if (result?.state === "prompt") {
                        Object.defineProperty(result, "state", { value: "denied" });
                    }
                    return result;
                }
                catch (error) {
                    return Promise.reject(error);
                }
            },
        });
    };
    const patchEventListeners = (w) => {
        if (!w)
            return;
        const originalAddEventListener = Element.prototype.addEventListener;
        Element.prototype.addEventListener = function (type, listener, options) {
            const wrappedListener = (event) => {
                const trustedEvent = { ...event, isTrusted: true };
                listener.call(this, trustedEvent);
            };
            originalAddEventListener.call(this, type, wrappedListener, options);
        };
    };
    const autoClickCloudflareCheckbox = (w) => {
        if (!w || !w.document || w.location.host !== "challenges.cloudflare.com")
            return;
        const targetSelector = "input[type=checkbox]";
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === "childList") {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const checkbox = node.querySelector(targetSelector);
                            if (checkbox) {
                                checkbox.parentElement?.click();
                            }
                        }
                    });
                }
            }
        });
        observer.observe(w.document.documentElement || w.document, {
            childList: true,
            subtree: true,
        });
    };
    patchWindow(window);
    patchEventListeners(window);
    autoClickCloudflareCheckbox(window);
}
