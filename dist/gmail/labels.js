"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GmailLabelLookupError = void 0;
exports.normalizeLabelList = normalizeLabelList;
exports.resolveLabelIds = resolveLabelIds;
class GmailLabelLookupError extends Error {
    constructor(message) {
        super(message);
        this.name = "GmailLabelLookupError";
    }
}
exports.GmailLabelLookupError = GmailLabelLookupError;
function normalizeLabelList(labels) {
    const normalizedLabels = labels.map((label) => ({
        id: label.id ?? "",
        name: label.name ?? "",
        type: label.type ?? "",
    }));
    normalizedLabels.sort((left, right) => {
        if ((left.type === "system") !== (right.type === "system")) {
            return left.type === "system" ? -1 : 1;
        }
        const byName = left.name.localeCompare(right.name, undefined, {
            sensitivity: "accent",
        });
        if (byName !== 0) {
            return byName;
        }
        return left.id.localeCompare(right.id);
    });
    return {
        count: normalizedLabels.length,
        labels: normalizedLabels,
    };
}
function resolveLabelIds(requestedLabels, availableLabels) {
    if (requestedLabels.length === 0) {
        return [];
    }
    const labelsById = new Map(availableLabels.map((label) => [label.id, label.id]));
    const labelsByName = new Map(availableLabels.map((label) => [label.name, label.id]));
    const labelsByFoldedName = new Map();
    for (const label of availableLabels) {
        const foldedName = label.name.toLocaleLowerCase();
        const existing = labelsByFoldedName.get(foldedName) ?? [];
        existing.push(label);
        labelsByFoldedName.set(foldedName, existing);
    }
    const resolved = [];
    const missing = [];
    const ambiguous = [];
    for (const requested of requestedLabels) {
        if (labelsById.has(requested)) {
            resolved.push(labelsById.get(requested) ?? requested);
            continue;
        }
        if (labelsByName.has(requested)) {
            resolved.push(labelsByName.get(requested) ?? requested);
            continue;
        }
        const foldedMatches = labelsByFoldedName.get(requested.toLocaleLowerCase()) ?? [];
        if (foldedMatches.length === 1) {
            resolved.push(foldedMatches[0].id);
            continue;
        }
        if (foldedMatches.length > 1) {
            ambiguous.push(requested);
            continue;
        }
        missing.push(requested);
    }
    if (missing.length === 0 && ambiguous.length === 0) {
        return resolved;
    }
    const details = [];
    if (missing.length > 0) {
        details.push(`not found: ${missing.join(", ")}`);
    }
    if (ambiguous.length > 0) {
        details.push(`ambiguous: ${ambiguous.join(", ")}`);
    }
    const userLabels = availableLabels
        .filter((label) => label.type !== "system")
        .map((label) => label.name);
    if (userLabels.length > 0) {
        details.push(`available user labels: ${userLabels.join(", ")}`);
    }
    throw new GmailLabelLookupError(`Label lookup failed; ${details.join("; ")}`);
}
