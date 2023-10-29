import { Component, MarkdownRenderer } from "obsidian";
import { DataArray } from "api/data-array";
import { QuerySettings } from "settings";
import { currentLocale } from "util/locale";
import { renderMinimalDate, renderMinimalDuration } from "util/normalize";
import { Literal, Values, Widgets } from "data-model/value";
import { InlineFieldLivePreviewComponent } from "./views/inline-field-live-preview";

/** Render simple fields compactly, removing wrapping content like paragraph and span. */
export async function renderCompactMarkdown(
    markdown: string,
    container: HTMLElement,
    sourcePath: string,
    component: Component
) {
    // check if the call is from the CM6 view plugin defined in src/ui/views/inline-field-live-preview.ts
    if (component instanceof InlineFieldLivePreviewComponent) {
        const tmpContainer = createSpan();
        await MarkdownRenderer.renderMarkdown(markdown, tmpContainer, sourcePath, component);

        let paragraph = tmpContainer.querySelector(":scope > p");
        if (tmpContainer.childNodes.length == 1 && paragraph) {
            container.replaceChildren(...paragraph.childNodes);
        } else {
            /**
             * In most cases, the condition above will be true.
             * However, it is not always true, for example:
             * ```dataviewjs
             * dv.paragraph(`
             * - list item 1
             * - list item 2
             *
             * 1. list item 3
             * 2. list item 4
             * `)
             * ```
             * MarkdownRenderer.renderMarkdown will render it as:
             * <span>
             *   <ul>
             *     <li>list item 1</li>
             *     <li>list item 2</li>
             *   </ul>
             *   <ol>
             *     <li>list item 3</li>
             *     <li>list item 4</li>
             *   </ol>
             * </span>
             * Notice that there is no <p> tag.
             */
            container.replaceChildren(...tmpContainer.childNodes);
        }

        tmpContainer.remove();
    } else {
        let subcontainer = container.createSpan();
        await MarkdownRenderer.renderMarkdown(markdown, subcontainer, sourcePath, component);

        let paragraph = subcontainer.querySelector(":scope > p");
        if (subcontainer.children.length == 1 && paragraph) {
            while (paragraph.firstChild) {
                subcontainer.appendChild(paragraph.firstChild);
            }
            subcontainer.removeChild(paragraph);
        }
    }
}

/** Render a pre block with an error in it; returns the element to allow for dynamic updating. */
export function renderErrorPre(container: HTMLElement, error: string): HTMLElement {
    let pre = container.createEl("pre", { cls: ["dataview", "dataview-error"] });
    pre.appendText(error);
    return pre;
}

/** Render a static codeblock. */
export function renderCodeBlock(container: HTMLElement, source: string, language?: string): HTMLElement {
    let code = container.createEl("code", { cls: ["dataview"] });
    if (language) code.classList.add("language-" + language);
    code.appendText(source);
    return code;
}

export type ValueRenderContext = "root" | "list";

/** Prettily render a value into a container with the given settings. */
export async function renderValue(
    field: Literal,
    container: HTMLElement,
    originFile: string,
    component: Component,
    settings: QuerySettings,
    expandList: boolean = false,
    context: ValueRenderContext = "root",
    depth: number = 0
) {
    // Prevent infinite recursion.
    if (depth > settings.maxRecursiveRenderDepth) {
        container.appendText("...");
        return;
    }

    if (Values.isNull(field)) {
        await renderCompactMarkdown(settings.renderNullAs, container, originFile, component);
    } else if (Values.isDate(field)) {
        container.appendText(renderMinimalDate(field, settings, currentLocale()));
    } else if (Values.isDuration(field)) {
        container.appendText(renderMinimalDuration(field));
    } else if (Values.isString(field) || Values.isBoolean(field) || Values.isNumber(field)) {
        await renderCompactMarkdown("" + field, container, originFile, component);
    } else if (Values.isLink(field)) {
        await renderCompactMarkdown(field.markdown(), container, originFile, component);
    } else if (Values.isHtml(field)) {
        container.appendChild(field);
    } else if (Values.isWidget(field)) {
        if (Widgets.isListPair(field)) {
            await renderValue(field.key, container, originFile, component, settings, expandList, context, depth);
            container.appendText(": ");
            await renderValue(field.value, container, originFile, component, settings, expandList, context, depth);
        } else if (Widgets.isExternalLink(field)) {
            let elem = document.createElement("a");
            elem.textContent = field.display ?? field.url;
            elem.rel = "noopener";
            elem.target = "_blank";
            elem.classList.add("external-link");
            elem.href = field.url;
            container.appendChild(elem);
        } else {
            container.appendText(`<unknown widget '${field.$widget}>`);
        }
    } else if (Values.isFunction(field)) {
        container.appendText("<function>");
    } else if (Values.isArray(field) || DataArray.isDataArray(field)) {
        if (expandList) {
            let list = container.createEl("ul", {
                cls: [
                    "dataview",
                    "dataview-ul",
                    context == "list" ? "dataview-result-list-ul" : "dataview-result-list-root-ul",
                ],
            });
            for (let child of field) {
                let li = list.createEl("li", { cls: "dataview-result-list-li" });
                await renderValue(child, li, originFile, component, settings, expandList, "list", depth + 1);
            }
        } else {
            if (field.length == 0) {
                container.appendText("<empty list>");
                return;
            }

            let span = container.createEl("span", { cls: ["dataview", "dataview-result-list-span"] });
            let first = true;
            for (let val of field) {
                if (first) first = false;
                else span.appendText(", ");

                await renderValue(val, span, originFile, component, settings, expandList, "list", depth + 1);
            }
        }
    } else if (Values.isObject(field)) {
        // Don't render classes in case they have recursive references; spoopy.
        if (field?.constructor?.name && field?.constructor?.name != "Object") {
            container.appendText(`<${field.constructor.name}>`);
            return;
        }

        if (expandList) {
            let list = container.createEl("ul", { cls: ["dataview", "dataview-ul", "dataview-result-object-ul"] });
            for (let [key, value] of Object.entries(field)) {
                let li = list.createEl("li", { cls: ["dataview", "dataview-li", "dataview-result-object-li"] });
                li.appendText(key + ": ");
                await renderValue(value, li, originFile, component, settings, expandList, "list", depth + 1);
            }
        } else {
            if (Object.keys(field).length == 0) {
                container.appendText("<empty object>");
                return;
            }

            let span = container.createEl("span", { cls: ["dataview", "dataview-result-object-span"] });
            let first = true;
            for (let [key, value] of Object.entries(field)) {
                if (first) first = false;
                else span.appendText(", ");

                span.appendText(key + ": ");
                await renderValue(value, span, originFile, component, settings, expandList, "list", depth + 1);
            }
        }
    } else {
        container.appendText("Unrecognized: " + JSON.stringify(field));
    }
}
