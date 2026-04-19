import * as fs from "fs";
import * as path from "path";
// --- PBIR path helpers + read-only access ---
export class PbirProject {
    reportPath;
    constructor(reportPath) {
        this.reportPath = reportPath;
    }
    get definitionPath() {
        return path.join(this.reportPath, "definition");
    }
    get pagesPath() {
        return path.join(this.definitionPath, "pages");
    }
    get pagesJsonPath() {
        return path.join(this.pagesPath, "pages.json");
    }
    pagePath(pageId) {
        return path.join(this.pagesPath, pageId);
    }
    pageJsonPath(pageId) {
        return path.join(this.pagePath(pageId), "page.json");
    }
    visualsPath(pageId) {
        return path.join(this.pagePath(pageId), "visuals");
    }
    visualPath(pageId, visualId) {
        return path.join(this.visualsPath(pageId), visualId);
    }
    visualJsonPath(pageId, visualId) {
        return path.join(this.visualPath(pageId, visualId), "visual.json");
    }
    // --- Read operations ---
    readJson(filePath) {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
    getPagesMetadata() {
        return this.readJson(this.pagesJsonPath);
    }
    getPage(pageId) {
        return this.readJson(this.pageJsonPath(pageId));
    }
    getVisual(pageId, visualId) {
        return this.readJson(this.visualJsonPath(pageId, visualId));
    }
    listPageIds() {
        return this.getPagesMetadata().pageOrder;
    }
    listVisualIds(pageId) {
        const visualsDir = this.visualsPath(pageId);
        if (!fs.existsSync(visualsDir))
            return [];
        return fs
            .readdirSync(visualsDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
    }
}
