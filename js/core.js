(function () {
  "use strict";

  var payload = window.PROTEOMICS_CATALOG || { tables: {} };

  function hydrate(table) {
    if (!table) return [];
    return (table.rows || []).map(function (values) {
      var row = {};
      (table.columns || []).forEach(function (column, index) {
        row[column] = values[index] == null ? "" : String(values[index]);
      });
      return row;
    });
  }

  var tables = payload.tables || {};
  var data = {
    meta: payload.meta || {},
    targets: hydrate(tables.targets),
    targetIsoforms: hydrate(tables.targetIsoforms),
    panels: hydrate(tables.panels),
    panelMembers: hydrate(tables.panelMembers),
    pathwayNodes: hydrate(tables.pathwayNodes),
    pathwayEdges: hydrate(tables.pathwayEdges),
    panelMaps: hydrate(tables.panelMaps),
    panelMapNodes: hydrate(tables.panelMapNodes),
    panelMapEdges: hydrate(tables.panelMapEdges)
  };

  var targetIndex = new Map(data.targets.map(function (row) { return [row.target_id, row]; }));
  var panelIndex = new Map(data.panels.map(function (row) { return [row.panel_id, row]; }));
  var isoformsByTarget = new Map();
  var membersByPanel = new Map();
  var panelsByTarget = new Map();
  var nodesByPanel = new Map();
  var edgesByPanel = new Map();
  var mapByPanel = new Map();
  var mapNodesByMap = new Map();
  var mapEdgesByMap = new Map();

  function append(index, key, value) {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(value);
  }

  data.targetIsoforms.forEach(function (row) { append(isoformsByTarget, row.target_id, row); });
  data.panelMembers.forEach(function (row) {
    append(membersByPanel, row.panel_id, row);
    append(panelsByTarget, row.target_id, row.panel_id);
  });
  data.pathwayNodes.forEach(function (row) { append(nodesByPanel, row.panel_id, row); });
  data.pathwayEdges.forEach(function (row) { append(edgesByPanel, row.panel_id, row); });
  data.panelMaps.forEach(function (row) { mapByPanel.set(row.panel_id, row); });
  data.panelMapNodes.forEach(function (row) { append(mapNodesByMap, row.map_id, row); });
  data.panelMapEdges.forEach(function (row) { append(mapEdgesByMap, row.map_id, row); });

  function sortByOrder(a, b) {
    return Number(a.display_order || 0) - Number(b.display_order || 0);
  }

  membersByPanel.forEach(function (rows) { rows.sort(sortByOrder); });
  data.panels.sort(sortByOrder);
  data.targets.sort(function (a, b) { return a.gene_symbol.localeCompare(b.gene_symbol); });

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function targetById(id) { return targetIndex.get(id) || null; }
  function panelById(id) { return panelIndex.get(id) || null; }
  function membersForPanel(id) {
    return (membersByPanel.get(id) || []).map(function (row) {
      return Object.assign({}, row, { target: targetById(row.target_id) });
    });
  }
  function panelsForTarget(id) {
    return (panelsByTarget.get(id) || []).map(panelById).filter(Boolean);
  }
  function isoformsForTarget(id) { return (isoformsByTarget.get(id) || []).slice().sort(sortByOrder); }
  function nodesForPanel(id) { return (nodesByPanel.get(id) || []).slice().sort(sortByOrder); }
  function edgesForPanel(id) { return (edgesByPanel.get(id) || []).slice().sort(sortByOrder); }
  function mapForPanel(id) {
    var meta = mapByPanel.get(id);
    if (!meta) return null;
    return { meta: meta, nodes: (mapNodesByMap.get(meta.map_id) || []).slice().sort(sortByOrder), edges: (mapEdgesByMap.get(meta.map_id) || []).slice().sort(sortByOrder) };
  }

  function publicState(value, registered) {
    var raw = String(value || "").toLowerCase();
    if (!registered || raw.indexOf("not_registered") !== -1 || raw.indexOf("登録測定系なし") !== -1 || raw.indexOf("現在の登録測定系なし") !== -1) return "not_registered";
    if (raw.indexOf("measured") !== -1 || raw.indexOf("測定実績あり") !== -1 || raw.indexOf("verified") !== -1 || raw.indexOf("active") !== -1) return "measured";
    return "candidate";
  }
  function statusLabel(value, registered) {
    return { measured: "測定実績あり", candidate: "測定候補", not_registered: "測定例なし" }[publicState(value, registered)];
  }
  function statusSymbol(value, registered) {
    return { measured: "●", candidate: "▲", not_registered: "□" }[publicState(value, registered)];
  }

  function relatedTargets(id) {
    var ids = new Set();
    panelsForTarget(id).forEach(function (panel) {
      membersForPanel(panel.panel_id).forEach(function (member) {
        if (member.target_id !== id) ids.add(member.target_id);
      });
    });
    return Array.from(ids).map(targetById).filter(Boolean).sort(function (a, b) {
      return a.gene_symbol.localeCompare(b.gene_symbol);
    });
  }

  function relatedPanels(id) {
    var counts = new Map();
    panelsForTarget(id).forEach(function (panel) {
      membersForPanel(panel.panel_id).forEach(function (member) {
        if (member.target_id !== id) counts.set(panel.panel_id, (counts.get(panel.panel_id) || 0) + 1);
      });
    });
    return panelsForTarget(id).map(function (panel) {
      return { panel: panel, sharedTargetCount: counts.get(panel.panel_id) || 0 };
    });
  }

  function childrenOfPanel(id) {
    return data.panels.filter(function (panel) { return panel.parent_panel_id === id; });
  }

  function parseHash(hash) {
    var value = (hash || "").replace(/^#/, "");
    if (!value || value === "targets") return { view: "targets" };
    if (value === "panels") return { view: "panels" };
    if (value === "selected") return { view: "selected" };
    var targetMatch = value.match(/^target\/(.+)$/);
    if (targetMatch) return { view: "target", id: decodeURIComponent(targetMatch[1]) };
    var panelMatch = value.match(/^panel\/(.+)$/);
    if (panelMatch) return { view: "panel", id: decodeURIComponent(panelMatch[1]) };
    return { view: "targets" };
  }

  function statusClass(status) {
    return "status--" + publicState(status, true).replace("not_registered", "unregistered");
  }

  function scopeLabel(scope) {
    return {
      isoform_specific: "Isoform-specific",
      shared_isoforms: "Multiple isoforms",
      canonical_reference: "Canonical reference",
      not_resolved: "Isoform not resolved",
      to_confirm: "To be confirmed"
    }[scope] || scope || "未指定";
  }

  window.CatalogCore = {
    data: data,
    escapeHtml: escapeHtml,
    targetById: targetById,
    panelById: panelById,
    membersForPanel: membersForPanel,
    panelsForTarget: panelsForTarget,
    isoformsForTarget: isoformsForTarget,
    nodesForPanel: nodesForPanel,
    edgesForPanel: edgesForPanel,
    mapForPanel: mapForPanel,
    relatedTargets: relatedTargets,
    relatedPanels: relatedPanels,
    childrenOfPanel: childrenOfPanel,
    parseHash: parseHash,
    statusClass: statusClass,
    publicState: publicState,
    statusLabel: statusLabel,
    statusSymbol: statusSymbol,
    scopeLabel: scopeLabel
  };
})();
