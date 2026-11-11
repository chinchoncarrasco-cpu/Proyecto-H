(function (root, factory) {
    const core = factory();
    if (typeof module === "object" && module.exports) module.exports = core;
    else root.HAIKU_REVISION_PLANTILLA_CORE_V1 = core;
})(globalThis, function () {
    "use strict";

    function payload(groups) {
        return groups.map(group => ({
            id: group.id,
            label: group.label === null ? null : group.label.trim(),
            items: group.items.map(item => ({ id: item.id, label: item.label.trim(), active: item.active }))
        }));
    }

    function updateGroup(groups, groupId, change) {
        return groups.map(group => group.id === groupId ? change(group) : group);
    }

    function renameGroup(groups, groupId, label) {
        return updateGroup(groups, groupId, group => ({ ...group, label }));
    }

    function renameItem(groups, groupId, itemId, label) {
        return updateGroup(groups, groupId, group => ({
            ...group, items: group.items.map(item => item.id === itemId ? { ...item, label } : item)
        }));
    }

    function addItem(groups, groupId, itemId, label) {
        return updateGroup(groups, groupId, group => ({
            ...group, items: [...group.items, { id: itemId, label, active: true }]
        }));
    }

    function setItemActive(groups, groupId, itemId, active, discardNew = false) {
        return updateGroup(groups, groupId, group => ({
            ...group,
            items: discardNew ? group.items.filter(item => item.id !== itemId)
                : group.items.map(item => item.id === itemId ? { ...item, active } : item)
        }));
    }

    function moveItem(groups, groupId, itemId, direction) {
        return updateGroup(groups, groupId, group => {
            const active = group.items.filter(item => item.active);
            const index = active.findIndex(item => item.id === itemId);
            const neighbor = active[index + direction];
            if (index < 0 || !neighbor) return group;
            const items = group.items.slice();
            const from = items.indexOf(active[index]);
            const to = items.indexOf(neighbor);
            [items[from], items[to]] = [items[to], items[from]];
            return { ...group, items };
        });
    }

    function changes(original, draft) {
        const before = payload(original);
        const after = payload(draft);
        const result = [];
        for (const [index, group] of after.entries()) {
            const previous = before[index];
            if (previous.label !== group.label) {
                result.push({ kind: "rename", label: previous.label, detail: group.label });
            }
            const oldItems = new Map(previous.items.map(item => [item.id, item]));
            for (const item of group.items) {
                const old = oldItems.get(item.id);
                if (!old) {
                    result.push({ kind: "add", label: item.label, detail: "Agregado" });
                    continue;
                }
                if (old.label !== item.label) {
                    result.push({ kind: "rename", label: old.label, detail: item.label });
                }
                if (old.active !== item.active) {
                    result.push({ kind: item.active ? "restore" : "archive", label: item.label,
                        detail: item.active ? "Recuperado" : "Desactivado" });
                }
            }
            const nextActive = group.items.filter(item => item.active && oldItems.get(item.id)?.active);
            const shared = new Set(nextActive.map(item => item.id));
            const order = previous.items.filter(item => shared.has(item.id)).map(item => item.id);
            for (const [target, item] of nextActive.entries()) {
                const current = order.indexOf(item.id);
                if (current === target) continue;
                order.splice(current, 1);
                order.splice(target, 0, item.id);
                result.push({ kind: "move", label: item.label,
                    detail: "Posición " + (current + 1) + " → " + (target + 1) });
            }
        }
        return result;
    }

    function validLabel(label) {
        const text = label.trim();
        return text.length > 0 && [...text].length <= 120 && !/[\u0000-\u001f\u007f]/.test(text);
    }

    return Object.freeze({ payload, renameGroup, renameItem, addItem, setItemActive, moveItem, changes, validLabel });
});
