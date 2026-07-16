(function () {
  "use strict";

  var C = window.CatalogCore;
  var E = C.escapeHtml;
  var views = ["targets-view", "selected-targets-view", "panels-view", "target-detail-view", "panel-detail-view"];
  var visibleStatuses = { measured: true, tested_not_detected: true, unexamined: true };
  var selectedTargets = new Map();
  var selectionStorageKey = "publicSelectionState";
  var scrollPositions = new Map();
  var lastSelectionCheckId = null;
  var lastSelectionTable = null;

  var sortKey = "status";
  var sortAsc = true;

  var statusPriority = { measured: 1, candidate: 2, unexamined: 2, borderline: 3, tested_not_detected: 3, unregistered: 2 };
  function getSortValue(target, key) {
    if (key === "select") {
      return selected(target) ? 1 : 2;
    }
    if (key === "status") {
      var state = C.publicState(target.measurement_state || target.measurement_status, true).replace("not_registered", "unregistered");
      return statusPriority[state] || 9;
    }
    if (key === "gene") return (target.gene_symbol || "").toLowerCase();
    if (key === "entry") return (target.uniprot_entry_name || "").toLowerCase();
    if (key === "protein") return (target.protein_name || "").toLowerCase();
    if (key === "isoform") return isoformsForTarget(target).length;
    if (key === "pathway") {
      return panelsForTarget(target).map(function (p) { return p.display_name_ja; }).join(" ");
    }
    return "";
  }
  function sortTargets(array) {
    return array.sort(function (a, b) {
      var valA = getSortValue(a, sortKey);
      var valB = getSortValue(b, sortKey);
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      if (sortKey !== "gene") {
        var geneA = (a.gene_symbol || "").toLowerCase();
        var geneB = (b.gene_symbol || "").toLowerCase();
        return geneA < geneB ? -1 : 1;
      }
      return 0;
    });
  }
  function updateSortIndicators() {
    document.querySelectorAll(".sortable-header").forEach(function (header) {
      var col = header.dataset.sortCol;
      var indicator = header.querySelector(".sort-indicator");
      if (col === sortKey) {
        indicator.textContent = sortAsc ? " ▲" : " ▼";
      } else {
        indicator.textContent = "";
      }
    });
  }

  function rememberCurrentScroll(context) {
    var route = location.hash;
    var parsed = C.parseHash(route);
    var state = {
      route: route,
      scrollY: window.scrollY,
      focused_panel_id: context && context.panelId || (parsed.view === "panel" ? parsed.id : ""),
      focused_node_id: context && context.nodeId || "",
      filter_state: {
        target: byId("target-search") ? byId("target-search").value : "",
        selected: byId("selected-search") ? byId("selected-search").value : "",
        panels: byId("panel-search") ? byId("panel-search").value : ""
      },
      sort_state: "gene_symbol",
      restore_pending: ["panels", "targets", "selected", "panel"].indexOf(parsed.view) !== -1
    };
    scrollPositions.set(route, state.scrollY);
    try {
      history.replaceState(Object.assign({}, history.state || {}, { route: route, scrollY: state.scrollY }), "", location.href);
    } catch (error) { /* history state may be unavailable */ }
    try { sessionStorage.setItem("catalogReturnState", JSON.stringify(state)); } catch (error) { /* storage may be unavailable */ }
  }
  function restoreCatalogPosition() {
    var state;
    try { state = JSON.parse(sessionStorage.getItem("catalogReturnState") || "null"); } catch (error) { state = null; }
    if (!state) return;
    var anchor = state.focused_node_id ? Array.from(document.querySelectorAll("[data-map-node]")).find(function (item) { return item.dataset.mapNode === state.focused_node_id; }) : null;
    if (!anchor && state.focused_panel_id) anchor = Array.from(document.querySelectorAll("[data-panel-id]")).find(function (item) { return item.dataset.panelId === state.focused_panel_id; });
    if (anchor) anchor.scrollIntoView({ block: "start" });
    else if (typeof state.scrollY === "number") window.scrollTo(0, state.scrollY);
    state.restore_pending = false;
    try { sessionStorage.setItem("catalogReturnState", JSON.stringify(state)); } catch (error) { /* storage may be unavailable */ }
  }
  function shouldRestoreCatalogPosition() {
    var current = C.parseHash(location.hash);
    var state;
    try { state = JSON.parse(sessionStorage.getItem("catalogReturnState") || "null"); } catch (error) { state = null; }
    return !!(state && state.restore_pending && (current.view === "panels" || current.view === "targets" || current.view === "selected"));
  }

  function targetById(id) { return C.targetById(id); }
  function isoformsForTarget(target) { return C.isoformsForTarget(target.target_id); }
  function panelsForTarget(target) { return C.panelsForTarget(target.target_id); }
  function locationPanelsForTarget(target) {
    var direct = panelsForTarget(target), result = [], seen = new Set();
    function addWithParents(panel) {
      var chain = [], current = panel;
      while (current) { chain.unshift(current); current = current.parent_panel_id ? C.panelById(current.parent_panel_id) : null; }
      chain.forEach(function (item) { if (!seen.has(item.panel_id)) { seen.add(item.panel_id); result.push(item); } });
    }
    direct.forEach(addWithParents);
    return result;
  }
  function allTargets() { return C.data.targets; }
  function isUnexamined(target) { var state = C.publicState(target && (target.measurement_state || target.measurement_status), true); return state === "unexamined" || state === "candidate"; }

  function selectionSourceIds(target) { return panelsForTarget(target).map(function (panel) { return panel.panel_id; }); }
  function selected(target) { return selectedTargets.has(target.target_id); }
  function saveSelectionState() {
    try {
      sessionStorage.setItem(selectionStorageKey, JSON.stringify({
        selection_version: 2,
        selected_targets: Array.from(selectedTargets.values()).map(function (item) {
          return { target_id: item.target.target_id, target_scope: item.target_scope || "protein", selected_isoform_ids: item.selected_isoform_ids || [], source_group_ids: item.source_group_ids || [], development_only: !!item.development_only };
        })
      }));
    } catch (error) { /* storage may be unavailable */ }
  }
  function restoreSelectionState() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(selectionStorageKey) || "null");
      (saved && saved.selected_targets || []).forEach(function (savedItem) {
        var target = targetById(savedItem.target_id);
        if (!target) return;
        addSelection(target, null, !!savedItem.development_only);
        var item = selectedTargets.get(target.target_id);
        item.target_scope = savedItem.target_scope || "protein";
        item.selected_isoform_ids = Array.from(new Set(savedItem.selected_isoform_ids || []));
        item.source_group_ids = savedItem.source_group_ids || selectionSourceIds(target);
      });
    } catch (error) { /* storage may be unavailable or stale */ }
  }
  function addSelection(target, sourceGroupId, developmentOnly) {
    if (!target) return;
    var current = selectedTargets.get(target.target_id) || { target: target, source_group_ids: [], development_only: !!developmentOnly };
    var ids = sourceGroupId ? current.source_group_ids.concat(sourceGroupId) : current.source_group_ids.concat(selectionSourceIds(target));
    current.source_group_ids = Array.from(new Set(ids));
    current.development_only = current.development_only || !!developmentOnly;
    selectedTargets.set(target.target_id, current);
  }
  function removeSelection(targetId) { selectedTargets.delete(targetId); }
  function removeSelectionIsoform(targetId, isoformId) {
    var item = selectedTargets.get(targetId);
    if (!item) return;
    item.selected_isoform_ids = (item.selected_isoform_ids || []).filter(function (id) { return id !== isoformId; });
    if (!item.selected_isoform_ids.length) removeSelection(targetId);
    else item.target_scope = isoformScopeForIds(item.target, item.selected_isoform_ids);
  }
  function setSelectionState(check, shouldSelect) {
    var target = targetById(check.dataset.selectionCheck);
    if (!target) return;
    if (shouldSelect) addSelection(target, check.dataset.selectionPanel || null, isUnexamined(target)); else removeSelection(target.target_id);
    check.checked = shouldSelect;
  }
  function selectCheckRange(check, shouldSelect) {
    var table = check.closest(".target-table"), checks = table ? Array.from(table.querySelectorAll("[data-selection-check]")) : [];
    var start = checks.findIndex(function (item) { return item.dataset.selectionCheck === lastSelectionCheckId; });
    var end = checks.findIndex(function (item) { return item === check; });
    if (start < 0 || end < 0) { setSelectionState(check, shouldSelect); return; }
    if (start > end) { var swap = start; start = end; end = swap; }
    checks.slice(start, end + 1).forEach(function (item) { if (!item.disabled) setSelectionState(item, shouldSelect); });
  }
  function rememberSelectionCheck(check) { lastSelectionCheckId = check.dataset.selectionCheck; lastSelectionTable = check.closest(".target-table"); }
  function toggleSelection(target, sourceGroupId, developmentOnly, checkbox) { if (selected(target)) removeSelection(target.target_id); else addSelection(target, sourceGroupId, developmentOnly); if (checkbox) checkbox.checked = selected(target); renderSelection(false); }
  function setTargetScope(target, scope, isoformIds) {
    if (!target) return;
    if (!selected(target)) addSelection(target, null, isUnexamined(target));
    var item = selectedTargets.get(target.target_id);
    item.target_scope = scope || "protein";
    item.selected_isoform_ids = Array.from(new Set(isoformIds || []));
    renderSelection(false);
  }
  function eligiblePanelRows(panel) {
    return panelRows(panel).filter(function (row) { if (!row.target) return false; var status = C.publicDisplayState(row.target.measurement_state || row.target.measurement_status, true); return !!visibleStatuses[status]; });
  }
  function panelFullySelected(panel) { var rows = eligiblePanelRows(panel); return rows.length > 0 && rows.every(function (row) { return selected(row.target) && (selectedTargets.get(row.target.target_id).source_group_ids || []).indexOf(panel.panel_id) !== -1; }); }
  function selectionPayload() { return { selection_version: 2, schema: "targeted-proteomics-selection/2", selected_targets: Array.from(selectedTargets.values()).map(function (item) { var target = item.target; var state = target.measurement_state || C.publicState(target.measurement_status, true), scope = item.target_scope || "protein", ids = item.selected_isoform_ids || [], unexamined = isUnexamined(target); return { target_id: target.target_id, public_target_id: target.target_id, gene_symbol: target.gene_symbol, uniprot_id: target.canonical_uniprot_id || "", target_scope: scope, isoforms: ids.map(function (id) { return { isoform_id: id, accession: id }; }), measurement_status: target.measurement_status || "", measurement_state: state, request_type: unexamined ? "assay_development" : "measurement", selection_type: unexamined ? "development" : "registered", source_group_ids: item.source_group_ids }; }) }; }
  function downloadSelection(type) {
    var payload = selectionPayload(), stamp = new Date().toISOString().slice(0, 10), blob, name;
    if (type === "json") { blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }); name = "selected-targets-" + stamp + ".json"; }
    else { var rows = ["target_id,gene_symbol,uniprot_id,measurement_status,measurement_state,request_type,source_group_ids"].concat(payload.selected_targets.map(function (row) { return [row.target_id, row.gene_symbol, row.uniprot_id, row.measurement_status, row.measurement_state, row.request_type, row.source_group_ids.join(";")].map(function (value) { return '"' + String(value).replace(/"/g, '""') + '"'; }).join(","); })); blob = new Blob(["\ufeff" + rows.join("\n")], { type: "text/csv;charset=utf-8" }); name = "selected-targets-" + stamp + ".csv"; }
    var link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = name; link.click(); URL.revokeObjectURL(link.href);
  }
  function renderSelection(syncChecks) {
    var count = selectedTargets.size, summary = byId("selection-toggle"), items = byId("selection-items");
    if (summary) summary.textContent = "選択中の測定対象：" + count;
    if (items) {
      var selectionRows = [];
      Array.from(selectedTargets.values()).forEach(function (item) {
        var ids = item.selected_isoform_ids || [];
        if (item.target_scope !== "protein" && ids.length) {
          ids.forEach(function (id) {
            var isoform = isoformsForTarget(item.target).find(function (candidate) { return candidate.isoform_id === id; });
            selectionRows.push('<div class="selection-item"><span><strong>' + E(isoformDisplayGene(item.target, id)) + '</strong><small>' + E(isoform ? isoformRowTitle(isoform, item.target) : id) + ' · ' + E(id) + '</small></span><button type="button" data-remove-selection-isoform="' + E(item.target.target_id) + '" data-remove-isoform-id="' + E(id) + '">解除</button></div>');
          });
        } else {
          selectionRows.push('<div class="selection-item"><span><strong>' + E(item.target.gene_symbol) + '</strong><small>Proteinレベル' + (item.development_only ? ' · 開発希望' : '') + '</small></span><button type="button" data-remove-selection="' + E(item.target.target_id) + '">解除</button></div>');
        }
      });
      items.innerHTML = selectionRows.length ? selectionRows.join("") : '<p class="muted">まだ選択されていません。</p>';
    }
    if (syncChecks !== false) document.querySelectorAll("[data-selection-check]").forEach(function (input) {
      var item = selectedTargets.get(input.dataset.selectionCheck);
      input.checked = !!item && (input.dataset.selectionIsoform ? (item.selected_isoform_ids || []).indexOf(input.dataset.selectionIsoform) !== -1 : true);
    });
    if (byId("selected-grid")) renderSelectedTargets();
    var targetToggle = byId("target-selection-toggle");
    if (targetToggle && window.currentDetailTarget) { targetToggle.setAttribute("aria-pressed", String(selected(window.currentDetailTarget))); targetToggle.textContent = (selected(window.currentDetailTarget) ? "☑" : "□") + " 測定対象に含める"; }
    saveSelectionState();
  }

  function byId(id) { return document.getElementById(id); }
  function showView(id) { views.forEach(function (view) { byId(view).hidden = view !== id; }); }
  function targetHref(id) { return "#target/" + encodeURIComponent(id); }
  function panelHref(id) { return "#panel/" + encodeURIComponent(id); }
  function statusBadge(value, registered, extraStyle) {
    var state = C.publicDisplayState(value, registered);
    var styleAttr = extraStyle ? ' style="' + E(extraStyle) + '"' : '';
    return '<span class="status status--' + state + '"' + styleAttr + '><b aria-hidden="true">' + C.statusSymbol(value, registered) + '</b> ' + E(C.statusLabel(value, registered)) + '</span>';
  }
  function panelLink(panel) {
    var label = panel.display_name_ja;
    if (panel.display_name_en && panel.display_name_en !== panel.display_name_ja) {
      label += ' (' + panel.display_name_en + ')';
    }
    return '<a class="chip-link" href="' + panelHref(panel.panel_id) + '">' + E(label) + '</a>';
  }
  function parentPanelLink(panel) {
    var parent = panel.parent_panel_id ? C.panelById(panel.parent_panel_id) : null;
    if (!parent) return '';
    return '<div class="panel-parent-context"><span>大分類</span>' + panelLink(parent) + '</div>';
  }
  function targetLink(target) { return '<a class="related-target-row" href="' + targetHref(target.target_id) + '"><strong>' + E(target.gene_symbol) + '</strong><span class="related-target-meta">' + isoformBadge(target) + statusBadge(target.measurement_status, true, "justify-self: start; width: fit-content;") + '</span></a>'; }

  function panelCounts(panel) {
    var counts = { measured: 0, tested_not_detected: 0, unexamined: 0 };
    var rows = panelRows(panel);
    rows.forEach(function (row) {
      if (!row.target) return;
      var state = C.publicDisplayState(row.target.measurement_state || row.target.measurement_status, true);
      if (Object.prototype.hasOwnProperty.call(counts, state)) counts[state] += 1;
    });
    return counts;
  }
  function countHtml(counts) { return '<div class="status-count-item count-measured"><span>● 測定可能</span><b>' + counts.measured + '</b></div><div class="status-count-item count-unexamined"><span>△ 未検討</span><b>' + counts.unexamined + '</b></div><div class="status-count-item count-tested"><span>■ 未検出</span><b>' + counts.tested_not_detected + '</b></div>'; }

  function isoformDisplayName(item, target) {
    var formal = item.uniprot_isoform_name || "";
    var base = item.isoform_id || "";
    var match = formal.match(/^Isoform\s+(.+?)\s+of\s+/i);
    if (match) {
      var token = match[1].trim();
      if (/^[A-Z]\d+$/i.test(token) || /^(?:M1|M2|MBP-1)$/i.test(token)) return target.gene_symbol + token;
      return target.gene_symbol + " isoform " + token;
    }
    var isoforms = isoformsForTarget(target);
    if (isoforms.length > 1) {
      if (item.isoform_name && item.isoform_name.indexOf("_HUMAN") !== -1 && item.isoform_name !== base) {
        return base + " (" + item.isoform_name + ")";
      }
      return item.isoform_name || base;
    }
    return base;
  }
  function isoformRowTitle(item, target) {
    var canonical = canonicalIsoform(target);
    if (canonical && canonical.isoform_id === item.isoform_id) return "Canonical";
    var suffix = String(item.isoform_id || "").match(/-(\d+)$/);
    if (suffix) return "Isoform " + suffix[1];
    var formal = item.uniprot_isoform_name || "";
    var match = formal.match(/^Isoform\s+(.+?)\s+of\s+/i);
    return match ? "Isoform " + match[1] : "Isoform";
  }
  function isoformDisplayGene(target, isoformId) {
    var suffix = String(isoformId || "").match(/-(\d+)$/);
    return target.gene_symbol + (suffix ? "-" + suffix[1] : "");
  }
  function isoformMeasurementLabel(item) {
    var mode = { isoform_specific: "区別して測定", shared_isoforms: "区別せずに測定", canonical_reference: "代表配列として測定", not_resolved: "区別せずに測定（isoform未確定）", to_confirm: "区別方法を要確認" }[item.measurement_scope] || "測定区分を要確認";
    return mode + " · " + C.statusLabel(item.measurement_state, true);
  }
  function isoformDistinctionLabel(target) {
    var isoforms = isoformsForTarget(target);
    if (isoforms.length <= 1) return "なし";
    var scopes = isoforms.map(function (item) { return item.measurement_scope || ""; });
    if (scopes.indexOf("isoform_specific") !== -1) return "区別あり";
    if (scopes.indexOf("shared_isoforms") !== -1) return "区別なし";
    return "未評価";
  }
  function isoformBadge(target) {
    var count = target ? isoformsForTarget(target).length : 0;
    return '<span class="isoform-badge">' + (count > 1 ? 'あり（' + count + '件） · ' + isoformDistinctionLabel(target) : 'なし') + '</span>';
  }
  function canonicalIsoform(target) {
    return isoformsForTarget(target).filter(function (item) { return item.canonical_flag === "1" || item.canonical_flag === 1 || item.measurement_scope === "canonical_reference"; })[0] || isoformsForTarget(target)[0] || null;
  }
  function isoformScopeForIds(target, ids) {
    var canonical = canonicalIsoform(target);
    return ids.length === 1 && canonical && ids[0] === canonical.isoform_id ? "canonical_isoform" : "specific_isoform";
  }
  function selectedIsoformNames(target, ids) {
    return (ids || []).map(function (id) {
      var item = isoformsForTarget(target).find(function (isoform) { return isoform.isoform_id === id; });
      return item ? isoformRowTitle(item, target) : id;
    });
  }
  function filterValues(prefix, key) {
    var host = byId(prefix + "-" + key);
    return host ? Array.from(host.querySelectorAll("input:checked")).map(function (input) { return input.value; }) : [];
  }
  function updateFilterSummary(host) {
    if (!host) return;
    var summary = host.querySelector("[data-filter-summary]"), selectedCount = host.querySelectorAll("input:checked").length;
    var label = host.dataset.filterLabel || "フィルター";
    if (summary) summary.textContent = label + "：" + (selectedCount ? selectedCount + "件選択" : "すべて");
  }
  function targetMatchesFor(target, prefix) {
    var query = byId(prefix + "-search").value.trim().toLowerCase();
    var queryTerms = query ? query.split(/\s+/).filter(Boolean) : [];
    var states = filterValues(prefix, "status-filter");
    var categories = filterValues(prefix, "category-filter");
    var panelIds = filterValues(prefix, "panel-filter");
    var isoformOnly = byId(prefix + "-isoform-filter").checked;

    if (prefix === "target" && target.record_type === "external_control") {
      return false;
    }

    var state = C.publicState(target.measurement_state || target.measurement_status, true);
    var displayState = C.publicDisplayState(target.measurement_state || target.measurement_status, true);
    var isoformText = isoformsForTarget(target).map(function (item) { return isoformDisplayName(item, target) + " " + (item.uniprot_isoform_name || ""); }).join(" ");

    var haystack = [
      target.gene_symbol,
      target.gene_name,
      target.protein_name,
      target.display_aliases,
      target.hgnc_id,
      target.ncbi_gene_id,
      target.ensembl_gene_id,
      target.canonical_uniprot_id,
      target.uniprot_entry_name,
      target.kegg_gene_id,
      target.detail_groups,
      target.pathway_tags,
      target.previous_symbols || "",
      isoformText
    ].join(" ").toLowerCase();

    var targetCategories = (target.category || "").split(";").map(function (s) { return s.trim(); }).filter(Boolean);
    var categoryMatch = !categories.length || categories.some(function (c) { return targetCategories.indexOf(c) !== -1; });

    var statusMatch = !states.length || states.some(function (filterState) { return displayState === filterState; });
    return (!queryTerms.length || queryTerms.every(function (term) { return haystack.indexOf(term) !== -1; })) &&
           statusMatch &&
           categoryMatch &&
           (!panelIds.length || panelsForTarget(target).some(function (panel) { return panelIds.indexOf(panel.panel_id) !== -1; })) &&
           (!isoformOnly || isoformsForTarget(target).length > 1);
  }
  function targetMatches(target) { return targetMatchesFor(target, "target"); }
  function targetRow(target, display) {
    var isoforms = isoformsForTarget(target);
    var panels = panelsForTarget(target).slice(0, 2);
    var selectionId = display && display.selectionTargetId || target.target_id;
    var displayGene = display && display.displayGene || target.gene_symbol;
    var displayIsoform = display && display.isoformName ? '<span class="selected-isoform-label">' + E(display.isoformName) + '</span>' : isoformBadge(target);
    var isoformAttribute = display && display.isoformId ? ' data-selection-isoform="' + E(display.isoformId) + '"' : '';
    var checked = display && display.isoformId ? (selectedTargets.get(selectionId) || {}).selected_isoform_ids && (selectedTargets.get(selectionId).selected_isoform_ids || []).indexOf(display.isoformId) !== -1 : selected(target);
    return '<div class="target-row" role="row"><span class="target-select-column" data-no-row-link><span class="target-select-box"><input type="checkbox" data-selection-check="' + E(selectionId) + '"' + isoformAttribute + ' aria-label="' + E(displayGene) + 'を測定対象に含める"' + (checked ? ' checked' : '') + '></span></span><a class="target-row-link" href="' + E(targetHref(target.target_id)) + '" data-target-link="' + E(targetHref(target.target_id)) + '"><span>' + statusBadge(target.measurement_state || target.measurement_status, true) + '</span><strong class="target-gene">' + E(displayGene) + '</strong><span class="target-entry-name">' + E(target.uniprot_entry_name || '') + '</span><span class="target-protein-name">' + E(target.protein_name || '') + '</span><span class="target-isoform-cell">' + displayIsoform + '</span><span class="target-pathways">' + panels.map(function (panel) { return E(panel.display_name_ja) + ' (' + E(panel.display_name_en) + ')'; }).join(" · ") + '</span></a></div>';
  }
  function renderSelectedTargets() {
    var entries = [];
    Array.from(selectedTargets.values()).forEach(function (item) {
      var ids = item.selected_isoform_ids || [];
      if (item.target_scope !== "protein" && ids.length) {
        ids.forEach(function (id) {
          var isoform = isoformsForTarget(item.target).find(function (candidate) { return candidate.isoform_id === id; });
          entries.push({ target: item.target, selectionTargetId: item.target.target_id, isoformId: id, displayGene: isoformDisplayGene(item.target, id), isoformName: isoform ? isoformRowTitle(isoform, item.target) : id });
        });
      } else {
        entries.push({ target: item.target, selectionTargetId: item.target.target_id });
      }
    });
    entries = entries.filter(function (entry) { return targetMatchesFor(entry.target, "selected"); });
    entries.sort(function (a, b) { var va = getSortValue(a.target, sortKey), vb = getSortValue(b.target, sortKey); if (va < vb) return sortAsc ? -1 : 1; if (va > vb) return sortAsc ? 1 : -1; return String(a.displayGene || a.target.gene_symbol).localeCompare(String(b.displayGene || b.target.gene_symbol)); });
    byId("selected-result-count").textContent = entries.length + " / " + selectedTargets.size;
    byId("selected-grid").innerHTML = entries.length ? entries.map(function (entry) { return targetRow(entry.target, entry); }).join("") : '<p class="empty-state">条件に一致する選択済みタンパク質がありません。</p>';
  }
  function renderTargets() {
    var all = allTargets();
    var matched = all.filter(targetMatches);

    var externalControls = all.filter(function (t) {
      if (t.record_type !== "external_control") return false;
      var query = byId("target-search").value.trim().toLowerCase();
      var queryTerms = query ? query.split(/\s+/).filter(Boolean) : [];
      var isoformText = isoformsForTarget(t).map(function (item) { return isoformDisplayName(item, t) + " " + (item.uniprot_isoform_name || ""); }).join(" ");
      var haystack = [t.gene_symbol, t.gene_name, t.protein_name, t.display_aliases, t.canonical_uniprot_id, t.detail_groups, t.pathway_tags, t.previous_symbols || "", isoformText].join(" ").toLowerCase();
      return !queryTerms.length || queryTerms.every(function (term) { return haystack.indexOf(term) !== -1; });
    });

    var proteinTargets = matched.filter(function (t) { return t.record_type !== "external_control"; });
    sortTargets(proteinTargets);

    byId("target-result-count").textContent = proteinTargets.length + " / " + all.filter(function(t) { return t.record_type !== "external_control"; }).length;

    var html = proteinTargets.length ? proteinTargets.map(targetRow).join("") : '<p class="empty-state">条件に一致するタンパク質がありません。</p>';

    var extHost = byId("external-controls-host");
    if (extHost) {
      if (externalControls.length) {
        extHost.hidden = false;
        byId("external-controls-grid").innerHTML = externalControls.map(targetRow).join("");
      } else {
        extHost.hidden = true;
      }
    }

    byId("target-grid").innerHTML = html;
  }
  function configureResizableTargetTables() {
    var columnKeys = ["select", "status", "gene", "entry", "protein", "isoform", "pathway"];
    document.querySelectorAll(".target-table").forEach(function (table, tableIndex) {
      var header = table.querySelector(":scope > .target-table-head");
      if (!header) return;
      var tableKey = table.getAttribute("aria-label") || "target-table-" + tableIndex;
      var storageKey = "publicTargetTableColumnWidths:" + tableKey;
      var saved = {};
      try { saved = JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch (error) { saved = {}; }
      Array.from(header.children).forEach(function (cell, index) {
        var key = cell.dataset.sortCol || columnKeys[index];
        if (!key) return;
        if (saved[key]) table.style.setProperty("--target-col-" + key, saved[key] + "px");
        if (cell.querySelector(".target-column-resizer")) return;
        var handle = document.createElement("span");
        handle.className = "target-column-resizer";
        handle.title = "列幅を変更";
        handle.addEventListener("mousedown", function (event) {
          event.preventDefault();
          event.stopPropagation();
          var startX = event.clientX;
          var startWidth = cell.getBoundingClientRect().width;
          table.classList.add("is-resizing");
          function move(moveEvent) {
            var width = Math.max(70, startWidth + moveEvent.clientX - startX);
            table.style.setProperty("--target-col-" + key, width + "px");
          }
          function finish() {
            table.classList.remove("is-resizing");
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", finish);
            saved[key] = Math.round(cell.getBoundingClientRect().width);
            try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch (error) { /* storage may be unavailable */ }
          }
          document.addEventListener("mousemove", move);
          document.addEventListener("mouseup", finish);
        });
        handle.addEventListener("click", function (event) { event.preventDefault(); event.stopPropagation(); });
        cell.appendChild(handle);
      });
    });
  }
  function panelCard(panel, anchorId) {
    var counts = panelCounts(panel);
    var nameHtml = E(panel.display_name_ja || panel.short_name || panel.panel_name);
    if (panel.display_name_en && panel.display_name_en !== panel.display_name_ja) {
      nameHtml += '<br><span class="panel-card-en" style="font-size: 19px; color: #283e56; font-weight: 700; display: block; margin-top: 5px; line-height: 1.2;">' + E(panel.display_name_en) + '</span>';
    }
    return '<a' + (anchorId ? ' id="' + E(anchorId) + '"' : '') + ' class="catalog-card panel-card" data-panel-id="' + E(panel.panel_id) + '" href="' + panelHref(panel.panel_id) + '"><h3>' + nameHtml + '</h3><p style="margin-top: 5px;">' + E(panel.description_ja || panel.purpose || panel.description || '') + '</p><div class="status-counts" style="margin-top: 10px;">' + countHtml(counts) + '</div></a>';
  }
  function renderPanels() {
    var query = byId("panel-search").value.trim().toLowerCase();
    var panels = C.data.panels.filter(function (panel) { return !query || [panel.display_name_ja, panel.display_name_en, panel.purpose, panel.description_ja].join(" ").toLowerCase().indexOf(query) !== -1; });

    // Jump links and lower domain sections share one intentional order.
    var domainOrder = ["PNL-MITO-001", "PNL-METAB-001", "PNL-PROT-001", "PNL-NAD-001", "PNL-REDOX-001", "PNL-DNA-001", "PNL-AA-001"];
    var domainRank = new Map(domainOrder.map(function (id, index) { return [id, index]; }));
    var groups = new Map();
    var domainPanels = C.data.panels.filter(function (p) { return p.catalog_group_type === "domain"; }).sort(function (a, b) {
      var rankA = domainRank.has(a.panel_id) ? domainRank.get(a.panel_id) : domainOrder.length;
      var rankB = domainRank.has(b.panel_id) ? domainRank.get(b.panel_id) : domainOrder.length;
      return rankA - rankB;
    });
    domainPanels.forEach(function (dp) { groups.set(dp.display_name_ja, []); });

    panels.forEach(function (panel) {
      if (panel.catalog_group_type === "domain") return;
      var parent = panel.parent_panel_id ? C.panelById(panel.parent_panel_id) : null;
      var groupKey = parent ? parent.display_name_ja : "その他";
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(panel);
    });

    byId("panel-result-count").textContent = panels.length + " / " + C.data.panels.length;
    var topLevel = domainPanels;
    var jumpHost = byId("panel-domain-jumps");
    if (jumpHost) jumpHost.innerHTML = topLevel.map(function (panel) { return '<button type="button" class="small-action" data-scroll-to="panel-domain-children-' + E(panel.panel_id) + '">' + E(panel.display_name_ja) + '</button>'; }).join("");
    var topBlock = topLevel.length ? '<section class="panel-group panel-group--top"><h2>大分類</h2><div id="panel-domain-items" class="catalog-grid catalog-grid--panels">' + topLevel.map(function (panel) { return panelCard(panel, "panel-domain-" + panel.panel_id); }).join("") + '</div></section>' : '';
    var childBlocks = Array.from(groups.entries()).map(function (entry) {
      var groupName = entry[0];
      var children = entry[1];
      if (groupName === "その他" && !children.length) return '';
      var parentId = children.length ? children[0].parent_panel_id : "";
      return children.length ? '<section' + (parentId ? ' id="panel-domain-children-' + E(parentId) + '"' : '') + ' class="panel-group"><h2>' + E(groupName) + '</h2><div class="catalog-grid catalog-grid--panels">' + children.map(panelCard).join("") + '</div></section>' : '';
    }).join("");
    byId("panel-groups").innerHTML = topBlock + childBlocks || '<p class="empty-state">条件に一致する経路・機能がありません。</p>';
  }
  function renderTargetDetail(target) {
    window.currentDetailTarget = target;
    showView("target-detail-view");
    byId("target-detail-symbol").textContent = target.gene_symbol;
    byId("target-detail-name").textContent = target.protein_name;
    byId("target-detail-status").innerHTML = statusBadge(target.measurement_status, true, "width: fit-content;");
    var summary = byId("target-detail-summary");
    summary.textContent = target.public_note || "";
    summary.hidden = !target.public_note;

    var panels = locationPanelsForTarget(target);
    var domainNames = [];
    var pathwayNames = [];

    panels.forEach(function (panel) {
      if (panel.catalog_group_type === "domain") {
        domainNames.push(panel.display_name_ja);
      } else {
        pathwayNames.push('<a href="' + panelHref(panel.panel_id) + '">' + E(panel.display_name_ja) + ' (' + E(panel.display_name_en) + ')</a>');
      }
    });

    if (!domainNames.length) {
      var direct = panelsForTarget(target);
      direct.forEach(function (panel) {
        var curr = panel;
        while (curr) {
          if (curr.catalog_group_type === "domain") {
            domainNames.push(curr.display_name_ja);
            break;
          }
          curr = curr.parent_panel_id ? C.panelById(curr.parent_panel_id) : null;
        }
      });
    }

    byId("target-detail-fields").innerHTML =
      '<div class="detail-field"><dt>遺伝子名</dt><dd>' + E(target.gene_name || "未指定") + '</dd></div>' +
      '<div class="detail-field"><dt>代表別名</dt><dd>' + E(target.display_aliases || "未指定") + '</dd></div>' +
      '<div class="detail-field"><dt>UniProt</dt><dd>' + E(target.canonical_uniprot_id || "未指定") + '</dd></div>' +
      (target.uniprot_entry_name ? '<div class="detail-field"><dt>Entry Name</dt><dd>' + E(target.uniprot_entry_name) + '</dd></div>' : '') +
      '<div class="detail-field"><dt>Isoform区別</dt><dd>' + E(isoformDistinctionLabel(target)) + '（登録 ' + E(isoformsForTarget(target).length) + '件）</dd></div>' +
      '<div class="detail-field"><dt>HGNC</dt><dd>' + E(target.hgnc_id || "未指定") + '</dd></div>' +
      '<div class="detail-field"><dt>NCBI Gene</dt><dd>' + E(target.ncbi_gene_id || "未指定") + '</dd></div>' +
      '<div class="detail-field"><dt>Ensembl Gene</dt><dd>' + E(target.ensembl_gene_id || "未指定") + '</dd></div>' +
      '<div class="detail-field"><dt>KEGG Gene</dt><dd>' + E(target.kegg_gene_id || "未指定") + '</dd></div>' +
      (target.sample_type && target.sample_type !== "未指定" ? '<div class="detail-field"><dt>対応試料</dt><dd>' + E(target.sample_type) + '</dd></div>' : '');

    var isoforms = isoformsForTarget(target), selectedItem = selectedTargets.get(target.target_id) || {}, selectedScope = selectedItem.target_scope || "protein", selectedIsoformIds = selectedItem.selected_isoform_ids || [], canonical = canonicalIsoform(target);
    byId("target-isoform-section").hidden = isoforms.length <= 1;
    if (isoforms.length > 1) {
      byId("target-isoform-title").innerHTML = 'Isoformあり · ' + E(isoformDistinctionLabel(target)) + ' <span class="isoform-title-badge">' + E('' + isoforms.length + '件') + '</span>';
      var choices = '<div class="isoform-selection-choices"><strong>測定対象の範囲</strong><label class="scope-choice"><input type="radio" name="target-scope" value="protein" data-target-scope="protein" data-target-id="' + E(target.target_id) + '"' + (selectedScope === "protein" ? ' checked' : '') + '> Proteinレベル</label><label class="scope-choice"><input type="radio" name="target-scope" value="specific_isoform" data-target-scope="specific_isoform" data-target-id="' + E(target.target_id) + '"' + (selectedScope !== "protein" ? ' checked' : '') + '> Isoformを区別</label><p class="isoform-selection-help">対象にするisoformを左側のチェックで選択できます。</p></div>';
      var isoformRows = isoforms.map(function (item) { var checked = selectedIsoformIds.indexOf(item.isoform_id) !== -1; return '<label class="isoform-display-row"><span class="isoform-display-check"><input type="checkbox" data-target-isoform="' + E(item.isoform_id) + '" data-target-id="' + E(target.target_id) + '"' + (checked ? ' checked' : '') + '> 対象</span><span class="isoform-display-info"><strong>' + E(isoformRowTitle(item, target)) + '</strong><small>' + E(item.isoform_id) + ' · ' + E(isoformMeasurementLabel(item)) + '</small></span></label>'; }).join("");
      byId("target-isoforms").innerHTML = choices + '<div class="isoform-list isoform-list--selectable">' + isoformRows + '</div>';
    } else {
      byId("target-isoform-title").textContent = "Isoform";
      byId("target-isoforms").innerHTML = '';
    }
    var related = C.relatedTargets(target.target_id);
    byId("target-related").innerHTML = related.length ? related.slice(0, 8).map(targetLink).join("") + (related.length > 8 ? '<button type="button" class="text-action" data-show-related>すべて表示 (' + related.length + ')</button><span class="all-related" hidden>' + related.slice(8).map(targetLink).join("") + '</span>' : '') : '<span class="muted">関連するタンパク質は登録されていません。</span>';

    var locations = [];
    var directPanels = panelsForTarget(target);
    var directIds = new Set(directPanels.map(function (p) { return p.panel_id; }));

    panels.forEach(function (panel) {
      var map = C.mapForPanel(panel.panel_id);
      var detail = panel.catalog_group_type === "domain" ? "大分類" : "経路上の位置";
      if (map) {
        (map.nodes || []).forEach(function (node) {
          var matches = node.target_id === target.target_id;
          if (matches) detail = node.module || "経路上の位置";
        });
      }
      var label = panel.display_name_ja;
      if (panel.display_name_en && panel.display_name_en !== panel.display_name_ja) {
        label += ' (' + panel.display_name_en + ')';
      }
      locations.push('<a class="location-chip' + (directIds.has(panel.panel_id) ? ' location-chip--direct' : ' location-chip--parent') + '" href="' + panelHref(panel.panel_id) + '"><strong>' + E(label) + '</strong><small>' + E(detail) + '</small></a>');
    });
    byId("target-location").innerHTML = locations.join("") || '<span class="muted">経路上の位置情報は登録されていません。</span>';
    var external = [[target.uniprot_url || (target.canonical_uniprot_id ? "https://www.uniprot.org/uniprotkb/" + encodeURIComponent(target.canonical_uniprot_id) : ""), "UniProt"], [target.reactome_url, "Reactome"], [target.string_url, "STRING"], [target.pubmed_url, "PubMed検索"]];
    byId("target-detail-links").innerHTML = external.filter(function (item) { return item[0]; }).map(function (item) { return '<a class="external-link" href="' + E(item[0]) + '" target="_blank" rel="noopener noreferrer">' + E(item[1]) + ' ↗</a>'; }).join("") || '<span class="muted">外部リンクは登録されていません。</span>';
    byId("target-note-section").hidden = true;
    renderSelection();
  }
  function panelRows(panel) {
    var rows = [], seen = new Set(), panels = [panel], panelSeen = new Set([panel.panel_id]);
    function addChildren(parent) {
      C.childrenOfPanel(parent.panel_id).forEach(function (child) {
        if (panelSeen.has(child.panel_id)) return;
        if (child.catalog_group_type === "cross_cutting_view") return;
        panelSeen.add(child.panel_id);
        panels.push(child);
        addChildren(child);
      });
    }
    if (panel.selection_scope === "self_and_descendants_unique" || panel.catalog_group_type === "domain" || !panel.parent_panel_id) {
      addChildren(panel);
    }
    panels.forEach(function (item) {
      C.membersForPanel(item.panel_id).forEach(function (member) {
        if (!member.target || seen.has(member.target_id)) return;
        seen.add(member.target_id);
        rows.push({ id: member.target_id, label: member.target.gene_symbol, target: member.target });
      });
    });
    var map = C.mapForPanel(panel.panel_id);
    (map ? map.nodes : []).forEach(function (node) {
      if (node.node_type !== "protein" || !node.target_id || seen.has(node.target_id)) return;
      var target = targetById(node.target_id);
      if (!target) return;
      seen.add(node.target_id);
      rows.push({ id: target.target_id, label: target.gene_symbol || node.label, target: target, node: node });
    });
    return rows.sort(function (a, b) { return a.label.localeCompare(b.label); });
  }
  function renderPanelTargets(panel) {
    var rows = panelRows(panel).filter(function (row) { var status = row.target ? C.publicDisplayState(row.target.measurement_state || row.target.measurement_status, true) : "unexamined"; return !!visibleStatuses[status]; });
    byId("panel-target-list").innerHTML = rows.map(function (row) { var value = row.target ? (row.target.measurement_state || row.target.measurement_status) : "未検討"; var displayState = C.publicDisplayState(value, true); var href = row.target ? targetHref(row.id) : "#"; var linkOpen = href === "#" ? '<span class="panel-target-link" data-target-link="#">' : '<a class="panel-target-link" href="' + E(href) + '" data-target-link="' + E(href) + '">'; var linkClose = href === "#" ? '</span>' : '</a>'; return '<div class="panel-target-row panel-target-row--' + displayState + '"><span class="target-select-column" data-no-row-link><span class="target-select-box"><input type="checkbox" data-selection-check="' + E(row.target ? row.target.target_id : row.id) + '" data-selection-panel="' + E(panel.panel_id) + '" aria-label="' + E(row.label) + 'を測定対象に含める"' + (row.target && selected(row.target) ? ' checked' : '') + '></span></span>' + linkOpen + '<strong>' + E(row.label) + '</strong><span class="panel-target-meta">' + (row.target ? isoformBadge(row.target) : '') + statusBadge(value, true) + '</span>' + linkClose + '</div>'; }).join("") || '<p class="muted">表示対象のタンパク質はありません。</p>';
    document.querySelectorAll("[data-status-filter]").forEach(function (button) { var status = button.dataset.statusFilter; button.setAttribute("aria-pressed", String(!!visibleStatuses[status])); });
    var bulk = document.querySelector("[data-panel-select]"), exclude = document.querySelector("[data-panel-exclude-unregistered]");
    if (bulk) { var fullySelected = panelFullySelected(panel); bulk.textContent = fullySelected ? "表示中のものを除外" : "表示されているものを追加"; bulk.dataset.panelBulkMode = fullySelected ? "remove" : "add"; }
    if (exclude) exclude.hidden = true;
  }
  function renderPanelDetail(panel) {
    showView("panel-detail-view");
    var title = E(panel.display_name_ja);
    if (panel.display_name_en && panel.display_name_en !== panel.display_name_ja) {
      title += '<br><span class="panel-detail-en" style="font-size: 28px; font-weight: 700; color: #283e56; display: block; margin-top: 8px; line-height: 1.2;">' + E(panel.display_name_en) + '</span>';
    }
    byId("panel-detail-title").innerHTML = title;
    byId("panel-detail-purpose").textContent = panel.description_ja || panel.purpose || "";
    var desc = panel.description_en || panel.description || "";
    if (panel.catalog_group_type === "cross_cutting_view") {
      desc = "【横断表示】 " + desc;
    }
    byId("panel-detail-description").textContent = desc;
    byId("panel-status-counts").innerHTML = countHtml(panelCounts(panel));
    var parentHost = byId("panel-parent-link"), parentLink = parentPanelLink(panel);
    parentHost.innerHTML = parentLink;
    parentHost.hidden = !parentLink;
    renderPanelTargets(panel);
    var mapHost = byId("panel-map-host");
    mapHost.innerHTML = '<p class="muted">経路図を準備しています。</p>';
    var drawMap = function () { var current = C.parseHash(location.hash); if (current.view === "panel" && current.id === panel.panel_id && window.PanelMapUI) window.PanelMapUI.render(mapHost, panel); };
    if (window.requestAnimationFrame) window.requestAnimationFrame(drawMap); else window.setTimeout(drawMap, 0);
    renderSelection();
  }
  function syncTabs() {
    var route = C.parseHash(location.hash);
    document.querySelectorAll("[data-public-tab]").forEach(function (tab) { var active = tab.dataset.publicTab === (route.view === "panels" || route.view === "panel" ? "panels" : "targets"); tab.classList.toggle("is-active", active); if (active) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current"); });
  }
  function renderRoute() {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    var routeState = history.state || {};
    var savedScroll = routeState.route === location.hash && Number.isFinite(Number(routeState.scrollY)) ? Number(routeState.scrollY) : null;
    var route = C.parseHash(location.hash);
    if (route.view === "target") { var target = targetById(route.id); if (target) renderTargetDetail(target); else { showView("targets-view"); renderTargets(); } }
    else if (route.view === "panel") { var panel = C.panelById(route.id); if (panel) renderPanelDetail(panel); else { showView("panels-view"); renderPanels(); } }
    else if (route.view === "panels") { showView("panels-view"); renderPanels(); }
    else if (route.view === "selected") { showView("selected-targets-view"); renderSelectedTargets(); }
    else { showView("targets-view"); renderTargets(); }
    syncTabs();
    // A newly entered hash is a new page and starts at the top. Restore only
    // when the matching history entry contains the previous scroll position.
    var destinationScroll = savedScroll == null ? 0 : savedScroll;
    requestAnimationFrame(function () { requestAnimationFrame(function () { window.scrollTo({ top: destinationScroll, behavior: "auto" }); }); });
  }
  function populateMultiFilter(id, label, options) {
    var host = byId(id), optionsHost = host.querySelector("[data-filter-options]");
    host.dataset.filterLabel = label;
    optionsHost.innerHTML = options.map(function (option) { return '<label><input type="checkbox" value="' + E(option.value) + '">' + E(option.label) + '</label>'; }).join("");
    updateFilterSummary(host);
  }
  function populateFilters() {
    var statuses = [{ value: "measured", label: "● 測定可能" }, { value: "unexamined", label: "△ 未検討" }, { value: "tested_not_detected", label: "■ 未検出" }];

    var categorySet = new Set();
    allTargets().forEach(function (target) {
      if (target.record_type === "external_control") return;
      (target.category || "").split(";").forEach(function (c) {
        var trimmed = c.trim();
        if (trimmed) categorySet.add(trimmed);
      });
    });
    var categories = Array.from(categorySet).sort().map(function (value) { return { value: value, label: value }; });

    var panels = C.data.panels.map(function (panel) { return { value: panel.panel_id, label: panel.display_name_ja || panel.short_name || panel.panel_name }; });
    ["target-status-filter", "selected-status-filter"].forEach(function (id) { populateMultiFilter(id, "測定状態", statuses); });
    ["target-category-filter", "selected-category-filter"].forEach(function (id) { populateMultiFilter(id, "大分類", categories); });
    ["target-panel-filter", "selected-panel-filter"].forEach(function (id) { populateMultiFilter(id, "経路・機能", panels); });
  }
  document.addEventListener("change", function (event) {
    var scopeChoice = event.target.closest("[data-target-scope]");
    if (scopeChoice) {
      var scopeTarget = targetById(scopeChoice.dataset.targetId), scope = scopeChoice.dataset.targetScope, checkedIsoforms = Array.from(document.querySelectorAll('[data-target-isoform][data-target-id="' + CSS.escape(scopeChoice.dataset.targetId) + '"]:checked')).map(function (input) { return input.dataset.targetIsoform; });
      if (scope === "canonical_isoform") { var canonicalChoice = canonicalIsoform(scopeTarget); checkedIsoforms = canonicalChoice ? [canonicalChoice.isoform_id] : []; }
      setTargetScope(scopeTarget, scope, checkedIsoforms);
      return;
    }
    var isoformChoice = event.target.closest("[data-target-isoform]");
    if (isoformChoice) {
      var isoformTarget = targetById(isoformChoice.dataset.targetId), selectedIsoforms = Array.from(document.querySelectorAll('[data-target-isoform][data-target-id="' + CSS.escape(isoformChoice.dataset.targetId) + '"]:checked')).map(function (input) { return input.dataset.targetIsoform; }), inferredScope = isoformScopeForIds(isoformTarget, selectedIsoforms);
      setTargetScope(isoformTarget, inferredScope, selectedIsoforms);
      var selectedRadio = document.querySelector('[data-target-scope="' + inferredScope + '"][data-target-id="' + CSS.escape(isoformChoice.dataset.targetId) + '"]');
      if (selectedRadio) selectedRadio.checked = true;
      return;
    }
    var check = event.target.closest("[data-selection-check]");
    if (!check) return;
    var target = targetById(check.dataset.selectionCheck);
    if (!target) return;
    rememberSelectionCheck(check);
    if (check.dataset.selectionIsoform) {
      if (!check.checked) removeSelectionIsoform(check.dataset.selectionCheck, check.dataset.selectionIsoform);
      renderSelection(false);
      return;
    }
    if (check.checked) addSelection(target, check.dataset.selectionPanel || null, isUnexamined(target)); else removeSelection(target.target_id);
    renderSelection(false);
  });
  document.addEventListener("click", function (event) {
    var activeFilter = event.target.closest(".multi-filter");
    document.querySelectorAll(".multi-filter[open]").forEach(function (filter) { if (filter !== activeFilter) filter.removeAttribute("open"); });
    var directCheck = event.target.closest("[data-selection-check]");
    if (directCheck && event.shiftKey && !directCheck.disabled) {
      var directTable = directCheck.closest(".target-table");
      if (directTable && lastSelectionTable === directTable && lastSelectionCheckId) {
        event.stopPropagation();
        selectCheckRange(directCheck, directCheck.checked);
        rememberSelectionCheck(directCheck);
        renderSelection(false);
        return;
      }
    }
    var noRowLink = event.target.closest("[data-no-row-link]");
    if (noRowLink) {
      event.stopPropagation();
      var columnCheck = noRowLink.querySelector("[data-selection-check]");
      if (columnCheck && !columnCheck.disabled) {
        if (event.target === columnCheck) {
          rememberSelectionCheck(columnCheck);
          return;
        }
        event.preventDefault();
      }
      return;
    }
    var internalLink = event.target.closest('a[href^="#"]');
    var returnTopLink = event.target.closest("[data-return-top]");
    if (internalLink) {
      if (!returnTopLink) rememberCurrentScroll();
      if (returnTopLink) {
        scrollPositions.set(internalLink.getAttribute("href"), 0);
        try {
          var returnState = JSON.parse(sessionStorage.getItem("catalogReturnState") || "null");
          if (returnState) { returnState.restore_pending = false; sessionStorage.setItem("catalogReturnState", JSON.stringify(returnState)); }
        } catch (error) { /* storage may be unavailable */ }
      }
    }
    var rowLink = event.target.closest("[data-target-link]");
    if (rowLink) { var textSelection = window.getSelection ? window.getSelection() : null; if (textSelection && !textSelection.isCollapsed) return; event.preventDefault(); var href = rowLink.dataset.targetLink; if (href && href !== "#") { rememberCurrentScroll(); location.hash = href.slice(1); } return; }
    var filterReset = event.target.closest("[data-filter-reset]");
    if (filterReset) {
      event.preventDefault();
      var filterPrefix = filterReset.dataset.filterReset;
      byId(filterPrefix + "-search").value = "";
      ["status-filter", "category-filter", "panel-filter"].forEach(function (key) { var host = byId(filterPrefix + "-" + key); host.querySelectorAll("input:checked").forEach(function (input) { input.checked = false; }); host.removeAttribute("open"); updateFilterSummary(host); });
      byId(filterPrefix + "-isoform-filter").checked = false;
      if (filterPrefix === "target") renderTargets(); else renderSelectedTargets();
      return;
    }
    var allRelated = event.target.closest("[data-show-related]");
    if (allRelated) { allRelated.hidden = true; allRelated.nextElementSibling.hidden = false; }
    var check = event.target.closest("[data-selection-check]");
    if (check) { event.stopPropagation(); return; }
    var selectionCell = event.target.closest("[data-no-row-link]");
    if (selectionCell) { event.preventDefault(); event.stopPropagation(); return; }
    var removeIsoform = event.target.closest("[data-remove-selection-isoform]");
    if (removeIsoform) { removeSelectionIsoform(removeIsoform.dataset.removeSelectionIsoform, removeIsoform.dataset.removeIsoformId); renderSelection(); return; }
    var remove = event.target.closest("[data-remove-selection]");
    if (remove) { removeSelection(remove.dataset.removeSelection); renderSelection(); return; }
    var targetToggle = event.target.closest("#target-selection-toggle");
    if (targetToggle) { event.preventDefault(); toggleSelection(window.currentDetailTarget, null, isUnexamined(window.currentDetailTarget)); return; }
    var statusFilter = event.target.closest("[data-status-filter]");
    if (statusFilter) { event.preventDefault(); var statusKey = statusFilter.dataset.statusFilter; visibleStatuses[statusKey] = !visibleStatuses[statusKey]; var statusRoute = C.parseHash(location.hash); var statusPanel = statusRoute.view === "panel" ? C.panelById(statusRoute.id) : null; if (statusPanel) renderPanelTargets(statusPanel); return; }
    var bulk = event.target.closest("[data-panel-select]");
    if (bulk) { event.preventDefault(); var bulkRoute = C.parseHash(location.hash), bulkPanel = bulkRoute.view === "panel" ? C.panelById(bulkRoute.id) : null; if (bulkPanel) { var bulkRows = eligiblePanelRows(bulkPanel), removeMode = bulk.dataset.panelBulkMode === "remove"; bulkRows.forEach(function (row) { if (removeMode) { var item = selectedTargets.get(row.target.target_id); if (item) { item.source_group_ids = (item.source_group_ids || []).filter(function (id) { return id !== bulkPanel.panel_id; }); if (!item.source_group_ids.length) removeSelection(row.target.target_id); } } else { addSelection(row.target, bulkPanel.panel_id, isUnexamined(row.target)); } }); renderPanelTargets(bulkPanel); renderSelection(); } return; }
    var exclude = event.target.closest("[data-panel-exclude-unregistered]");
    if (exclude) { event.preventDefault(); var excludeRoute = C.parseHash(location.hash), excludePanel = excludeRoute.view === "panel" ? C.panelById(excludeRoute.id) : null; if (excludePanel) { panelRows(excludePanel).forEach(function (row) { if (!row.target || C.publicState(row.target.measurement_state || row.target.measurement_status, true) !== "unexamined") return; var item = selectedTargets.get(row.target.target_id); if (!item) return; item.source_group_ids = (item.source_group_ids || []).filter(function (id) { return id !== excludePanel.panel_id; }); if (!item.source_group_ids.length) removeSelection(row.target.target_id); }); renderPanelTargets(excludePanel); renderSelection(); } return; }
    var selectionToggle = event.target.closest("#selection-toggle");
    if (selectionToggle) { var drawer = byId("selection-drawer"); drawer.hidden = !drawer.hidden; selectionToggle.setAttribute("aria-expanded", String(!drawer.hidden)); return; }
    var selectionListLink = event.target.closest(".selection-page-link,.selection-drawer-link");
    if (selectionListLink) {
      byId("selection-drawer").hidden = true;
      byId("selection-toggle").setAttribute("aria-expanded", "false");
      return;
    }
    var selectionDrawer = byId("selection-drawer");
    if (selectionDrawer && !selectionDrawer.hidden && !event.target.closest(".selection-bar")) {
      selectionDrawer.hidden = true;
      byId("selection-toggle").setAttribute("aria-expanded", "false");
    }
    var scrollTo = event.target.closest("[data-scroll-to]");
    if (scrollTo) { event.preventDefault(); var destination = byId(scrollTo.dataset.scrollTo); if (destination) destination.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (event.target.closest("#selection-close")) { byId("selection-drawer").hidden = true; return; }
    if (event.target.closest("#selection-clear")) { selectedTargets.clear(); renderSelection(); return; }
    if (event.target.closest("#selection-json") || event.target.closest("#selection-page-json")) { downloadSelection("json"); return; }
    if (event.target.closest("#selection-csv") || event.target.closest("#selection-page-csv")) { downloadSelection("csv"); return; }
    var sortHeader = event.target.closest(".sortable-header");
    if (sortHeader) {
      event.preventDefault();
      var key = sortHeader.dataset.sortCol;
      if (key === sortKey) {
        sortAsc = !sortAsc;
      } else {
        sortKey = key;
        sortAsc = true;
      }
      updateSortIndicators();
      renderTargets();
      renderSelectedTargets();
      return;
    }
  });
  window.CatalogNavigation = { rememberScroll: rememberCurrentScroll };
  function configurePublicStatusVisibility() {
    document.querySelectorAll(".status-visibility-filters").forEach(function (host) {
      host.innerHTML = '<button type="button" class="visibility-toggle" data-status-filter="measured" aria-pressed="true">● 測定可能</button><button type="button" class="visibility-toggle" data-status-filter="unexamined" aria-pressed="true">△ 未検討</button><button type="button" class="visibility-toggle" data-status-filter="tested_not_detected" aria-pressed="true">■ 未検出</button>';
    });
  }
  document.addEventListener("DOMContentLoaded", function () {
    populateFilters();
    configurePublicStatusVisibility();
    configureResizableTargetTables();
    restoreSelectionState();
    renderSelection();
    updateSortIndicators();
    var proteinTargets = allTargets().filter(function(t) { return t.record_type !== "external_control"; });
    byId("target-measured").textContent = proteinTargets.filter(function(t) {
      return C.publicState(t.measurement_state || t.measurement_status, true) === "measured";
    }).length;
    byId("target-search").addEventListener("input", renderTargets);
    ["target-status-filter", "target-category-filter", "target-panel-filter"].forEach(function (id) { byId(id).addEventListener("change", function (event) { updateFilterSummary(event.currentTarget); renderTargets(); }); });
    byId("target-isoform-filter").addEventListener("change", renderTargets);
    byId("selected-search").addEventListener("input", renderSelectedTargets);
    ["selected-status-filter", "selected-category-filter", "selected-panel-filter"].forEach(function (id) { byId(id).addEventListener("change", function (event) { updateFilterSummary(event.currentTarget); renderSelectedTargets(); }); });
    byId("selected-isoform-filter").addEventListener("change", renderSelectedTargets);
    byId("panel-search").addEventListener("input", renderPanels);
    window.addEventListener("hashchange", renderRoute);
    if (!location.hash) location.hash = "targets";
    renderRoute();
  });
})();
