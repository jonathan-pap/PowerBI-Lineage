import { PbirProject } from "./pbir-reader.js";
function extractFieldRef(field) {
    if (field.Measure) {
        return { fieldType: "measure", fieldName: field.Measure.Property, tableName: field.Measure.Expression?.SourceRef?.Entity || "" };
    }
    else if (field.Column) {
        return { fieldType: "column", fieldName: field.Column.Property, tableName: field.Column.Expression?.SourceRef?.Entity || "" };
    }
    else if (field.Aggregation) {
        const col = field.Aggregation.Expression?.Column;
        if (col)
            return { fieldType: "aggregation", fieldName: col.Property, tableName: col.Expression?.SourceRef?.Entity || "" };
    }
    else if (field.HierarchyLevel) {
        const h = field.HierarchyLevel;
        const entity = h.Expression?.Hierarchy?.Expression?.SourceRef?.Entity;
        const level = h.Level;
        if (entity && level)
            return { fieldType: "column", fieldName: level, tableName: entity };
    }
    return null;
}
function extractVisualTitle(visual) {
    try {
        const vco = visual.visual?.visualContainerObjects;
        if (vco?.title) {
            for (const item of vco.title) {
                const textProp = item?.properties?.text;
                if (textProp?.expr?.Literal?.Value) {
                    return textProp.expr.Literal.Value.replace(/^'(.*)'$/, "$1");
                }
            }
        }
    }
    catch { /* fallback */ }
    return "";
}
export function scanReportBindings(reportPath) {
    const project = new PbirProject(reportPath);
    const pageIds = project.listPageIds();
    const bindings = [];
    const hiddenPages = [];
    const allPages = [];
    let totalVisuals = 0;
    for (const pageId of pageIds) {
        const page = project.getPage(pageId);
        const pageName = page.displayName || pageId;
        const isHidden = page.visibility === "HiddenInViewMode";
        if (isHidden)
            hiddenPages.push(pageName);
        const visualIds = project.listVisualIds(pageId);
        allPages.push({ name: pageName, hidden: isHidden, visualCount: visualIds.length });
        for (const visualId of visualIds) {
            totalVisuals++;
            try {
                const visual = project.getVisual(pageId, visualId);
                const visualType = visual.visual?.visualType || "unknown";
                const visualTitle = extractVisualTitle(visual) || visualType;
                const vId = visual.name || visualId;
                const ctx = { pageId, pageName, visualId: vId, visualType, visualTitle };
                // Scan queryState projections
                const queryState = visual.visual?.query?.queryState;
                if (queryState) {
                    for (const [bucket, bucketData] of Object.entries(queryState)) {
                        const projections = bucketData.projections || [];
                        for (const proj of projections) {
                            if (!proj.field)
                                continue;
                            const ref = extractFieldRef(proj.field);
                            if (ref)
                                bindings.push({ ...ref, bindingRole: bucket, ...ctx });
                        }
                    }
                }
                // Scan filter bindings
                const filters = visual.filterConfig?.filters || [];
                for (const f of filters) {
                    if (!f.field)
                        continue;
                    const ref = extractFieldRef(f.field);
                    if (ref)
                        bindings.push({ ...ref, bindingRole: "Filter", ...ctx });
                }
                // Scan objects section (conditional formatting: images, reference labels, colors, icons, etc.)
                const objects = visual.visual?.objects;
                if (objects && typeof objects === "object") {
                    const walkExpr = (obj, role) => {
                        if (!obj || typeof obj !== "object")
                            return;
                        if (obj.expr) {
                            const ref = extractFieldRef(obj.expr);
                            if (ref)
                                bindings.push({ ...ref, bindingRole: role, ...ctx });
                        }
                        if (Array.isArray(obj)) {
                            for (const item of obj)
                                walkExpr(item, role);
                        }
                        else {
                            for (const val of Object.values(obj))
                                walkExpr(val, role);
                        }
                    };
                    for (const [objectType, objectArr] of Object.entries(objects)) {
                        walkExpr(objectArr, objectType);
                    }
                }
            }
            catch { /* skip unreadable visuals */ }
        }
    }
    return { bindings, pageCount: pageIds.length, visualCount: totalVisuals, hiddenPages, allPages };
}
