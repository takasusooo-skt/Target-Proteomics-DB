(function () {
  "use strict";

  var C = window.CatalogCore;
  var E = C.escapeHtml;
  var views = ["targets-view", "selected-targets-view", "panels-view", "target-detail-view", "panel-detail-view"];
  var virtualTargetsById = new Map();
  var visibleStatuses = { measured: true, candidate: true, not_registered: true };
  var selectedTargets = new Map();
  var scrollPositions = new Map();
  var lastSelectionCheckId = null;
  var lastSelectionTable = null;

  C.data.panels.forEach(function (panel) {
    var map = C.mapForPanel(panel.panel_id);
    (map ? map.nodes : []).forEach(function (node) {
      if (node.node_type !== "protein" || node.target_id) return;
      var id = "virtual/" + node.node_id;
      var target = virtualTargetsById.get(id);
      if (!target) {
        target = { target_id: id, virtual: true, gene_symbol: node.label, protein_name: "", category: panel.category || "Other", measurement_status: "not_registered", public_note: node.public_note || "", canonical_uniprot_id: node.uniprot_id || "", node: node, panel_ids: [] };
        virtualTargetsById.set(id, target);
      }
      if (target.panel_ids.indexOf(panel.panel_id) === -1) target.panel_ids.push(panel.panel_id);
    });
  });
  var virtualTargets = Array.from(virtualTargetsById.values());
  function targetById(id) { return C.targetById(id) || virtualTargetsById.get(id) || null; }
  function isoformsForTarget(target) { return target.virtual ? [] : C.isoformsForTarget(target.target_id); }
  function panelsForTarget(target) { return target.virtual ? target.panel_ids.map(C.panelById).filter(Boolean) : C.panelsForTarget(target.target_id); }
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
  function allTargets() { return C.data.targets.concat(virtualTargets); }

  function selectionSourceIds(target) { return target.virtual ? [] : panelsForTarget(target).map(function (panel) { return panel.panel_id; }); }
  function selected(target) { return selectedTargets.has(target.target_id); }
  function addSelection(target, sourceGroupId, developmentOnly) {
    if (!target) return;
    if (target.virtual && !developmentOnly) return;
    var current = selectedTargets.get(target.target_id) || { target: target, source_group_ids: [], development_only: !!developmentOnly };
    var ids = sourceGroupId ? current.source_group_ids.concat(sourceGroupId) : current.source_group_ids.concat(selectionSourceIds(target));
    current.source_group_ids = Array.from(new Set(ids));
    current.development_only = current.development_only || !!developmentOnly;
    selectedTargets.set(target.target_id, current);
  }
  function removeSelection(targetId) { selectedTargets.delete(targetId); }
  function setSelectionState(check, shouldSelect) {
    var target = targetById(check.dataset.selectionCheck);
    if (!target) return;
    if (shouldSelect) addSelection(target, check.dataset.selectionPanel || null, !!target.virtual); else removeSelection(target.target_id);
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
  function eligiblePanelRows(panel) {
    return panelRows(panel).filter(function (row) { if (!row.target) return false; var status = C.publicState(row.target.measurement_status, !row.target.virtual); return !!visibleStatuses[status]; });
  }
  function panelFullySelected(panel) { var rows = eligiblePanelRows(panel); return rows.length > 0 && rows.every(function (row) { return selected(row.target) && (selectedTargets.get(row.target.target_id).source_group_ids || []).indexOf(panel.panel_id) !== -1; }); }
  function selectionPayload() { return { schema: "targeted-proteomics-selection/1.0", selected_targets: Array.from(selectedTargets.values()).map(function (item) { var target = item.target; return { target_id: target.target_id, gene_symbol: target.gene_symbol, uniprot_id: target.canonical_uniprot_id || target.uniprot_id || "", measurement_status: target.virtual ? "測定例なし" : target.measurement_status || "", source_group_ids: item.source_group_ids }; }) }; }
  function downloadSelection(type) {
    var payload = selectionPayload(), stamp = new Date().toISOString().slice(0, 10), blob, name;
    if (type === "json") { blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }); name = "selected-targets-" + stamp + ".json"; }
    else { var rows = ["target_id,gene_symbol,uniprot_id,measurement_status,source_group_ids"].concat(payload.selected_targets.map(function (row) { return [row.target_id, row.gene_symbol, row.uniprot_id, row.measurement_status, row.source_group_ids.join(";")].map(function (value) { return '"' + String(value).replace(/"/g, '""') + '"'; }).join(","); })); blob = new Blob(["\ufeff" + rows.join("\n")], { type: "text/csv;charset=utf-8" }); name = "selected-targets-" + stamp + ".csv"; }
    var link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = name; link.click(); URL.revokeObjectURL(link.href);
  }
  function renderSelection(syncChecks) {
    var count = selectedTargets.size, summary = byId("selection-toggle"), items = byId("selection-items");
    if (summary) summary.textContent = "選択中の測定対象：" + count;
    if (items) items.innerHTML = count ? Array.from(selectedTargets.values()).map(function (item) { return '<div class="selection-item"><span><strong>' + E(item.target.gene_symbol) + '</strong>' + (item.development_only ? '<small> 開発希望</small>' : '') + '</span><button type="button" data-remove-selection="' + E(item.target.target_id) + '">解除</button></div>'; }).join("") : '<p class="muted">まだ選択されていません。</p>';
    if (syncChecks !== false) document.querySelectorAll("[data-selection-check]").forEach(function (input) { input.checked = selectedTargets.has(input.dataset.selectionCheck); });
    if (byId("selected-grid")) renderSelectedTargets();
    var targetToggle = byId("target-selection-toggle");
    if (targetToggle && window.currentDetailTarget) { targetToggle.setAttribute("aria-pressed", String(selected(window.currentDetailTarget))); targetToggle.textContent = (selected(window.currentDetailTarget) ? "☑" : "□") + " 測定対象に含める"; }
  }

  function byId(id) { return document.getElementById(id); }
  function showView(id) { views.forEach(function (view) { byId(view).hidden = view !== id; }); }
  function targetHref(id) { return "#target/" + encodeURIComponent(id); }
  function panelHref(id) { return "#panel/" + encodeURIComponent(id); }
  function statusBadge(value, registered) {
    var state = C.publicState(value, registered);
    return '<span class="status status--' + state.replace("not_registered", "unregistered") + '"><b aria-hidden="true">' + C.statusSymbol(value, registered) + '</b> ' + E(C.statusLabel(value, registered)) + '</span>';
  }
  function panelLink(panel) { return '<a class="chip-link" href="' + panelHref(panel.panel_id) + '">' + E(panel.display_name_ja || panel.short_name || panel.panel_name) + '</a>'; }
  function targetLink(target) { return '<a class="related-target-row" href="' + targetHref(target.target_id) + '"><strong>' + E(target.gene_symbol) + '</strong>' + statusBadge(target.measurement_status, true) + '</a>'; }

  function panelCounts(panel) {
    var children = C.childrenOfPanel(panel.panel_id);
    if (panel.panel_type === "umbrella" && children.length) {
      return children.reduce(function (sum, child) { var count = panelCounts(child); sum.measured += count.measured; sum.candidate += count.candidate; sum.not_registered += count.not_registered; return sum; }, { measured: 0, candidate: 0, not_registered: 0 });
    }
    var counts = { measured: 0, candidate: 0, not_registered: 0 }, seen = new Set();
    C.membersForPanel(panel.panel_id).forEach(function (member) { if (!member.target || seen.has(member.target_id)) return; seen.add(member.target_id); counts[C.publicState(member.target.measurement_status, true)] += 1; });
    var map = C.mapForPanel(panel.panel_id);
    (map ? map.nodes : []).forEach(function (node) { if (node.node_type !== "protein" || node.target_id || seen.has(node.node_id)) return; if (C.publicState(node.state, false) === "not_registered") { counts.not_registered += 1; seen.add(node.node_id); } });
    return counts;
  }
  function countHtml(counts) { return '<div class="status-count-item count-measured"><span>● 測定実績あり</span><b>' + counts.measured + '</b></div><div class="status-count-item count-candidate"><span>▲ 測定候補</span><b>' + counts.candidate + '</b></div><div class="status-count-item count-unregistered"><span>□ 測定例なし</span><b>' + counts.not_registered + '</b></div>'; }

  function isoformDisplayName(item, target) {
    var formal = item.uniprot_isoform_name || "";
    var match = formal.match(/^Isoform\s+(.+?)\s+of\s+/i);
    if (match) {
      var token = match[1].trim();
      if (/^[A-Z]\d+$/i.test(token) || /^(?:M1|M2|MBP-1)$/i.test(token)) return target.gene_symbol + token;
      return target.gene_symbol + " isoform " + token;
    }
    return item.isoform_name || item.isoform_id;
  }
  function isoformMeasurementLabel(item) {
    var mode = { isoform_specific: "区別して測定", shared_isoforms: "区別せずに測定", canonical_reference: "代表配列として測定", not_resolved: "区別せずに測定（isoform未確定）", to_confirm: "区別方法を要確認" }[item.measurement_scope] || "測定区分を要確認";
    return mode + " · " + C.statusLabel(item.measurement_state, true);
  }
  function filterValues(prefix, key) {
    var host = byId(prefix + "-" + key);
    return host ? Array.from(host.querySelectorAll("input:checked")).map(function (input) { return input.value; }) : [];
  }
  function updateFilterSummary(host) {
    if (!host) return;
    var summary = host.querySelector("[data-filter-summary]"), selectedCount = host.querySelectorAll("input:checked").length;
    if (summary) summary.textContent = host.dataset.filterLabel + "：" + (selectedCount ? selectedCount + "件選択" : "すべて");
  }
  function targetMatchesFor(target, prefix) {
    var query = byId(prefix + "-search").value.trim().toLowerCase();
    var queryTerms = query ? query.split(/\s+/).filter(Boolean) : [];
    var states = filterValues(prefix, "status-filter");
    var categories = filterValues(prefix, "category-filter");
    var panelIds = filterValues(prefix, "panel-filter");
    var isoformOnly = byId(prefix + "-isoform-filter").checked;
    var state = C.publicState(target.measurement_status, !target.virtual);
    var isoformText = isoformsForTarget(target).map(function (item) { return isoformDisplayName(item, target) + " " + (item.uniprot_isoform_name || ""); }).join(" ");
    var haystack = [target.gene_symbol, target.gene_name, target.protein_name, target.display_aliases, target.hgnc_id, target.ncbi_gene_id, target.ensembl_gene_id, target.canonical_uniprot_id, target.kegg_gene_id, target.detail_groups, target.pathway_tags, isoformText].join(" ").toLowerCase();
    return (!queryTerms.length || queryTerms.every(function (term) { return haystack.indexOf(term) !== -1; })) && (!states.length || states.indexOf(state) !== -1) && (!categories.length || categories.indexOf(target.category) !== -1) && (!panelIds.length || panelsForTarget(target).some(function (panel) { return panelIds.indexOf(panel.panel_id) !== -1; })) && (!isoformOnly || isoformsForTarget(target).length > 0);
  }
  function targetMatches(target) { return targetMatchesFor(target, "target"); }
  function targetRow(target) {
    var isoforms = isoformsForTarget(target);
    var panels = panelsForTarget(target).slice(0, 2);
    return '<div class="target-row" role="row"><span class="target-select-column" data-no-row-link><span class="target-select-box"><input type="checkbox" data-selection-check="' + E(target.target_id) + '" aria-label="' + E(target.gene_symbol) + 'を測定対象に含める"' + (selected(target) ? ' checked' : '') + '></span></span><a class="target-row-link" href="' + E(targetHref(target.target_id)) + '" data-target-link="' + E(targetHref(target.target_id)) + '"><span>' + statusBadge(target.measurement_status, !target.virtual) + '</span><strong class="target-gene">' + E(target.gene_symbol) + '</strong><span class="target-protein-name">' + E(target.protein_name || '') + '</span><span class="target-isoform-cell">' + (isoforms.length ? E(isoforms.map(function (item) { return isoformDisplayName(item, target); }).join(" / ")) : '') + '</span><span class="target-pathways">' + panels.map(function (panel) { return E(panel.display_name_ja || panel.short_name || panel.panel_name); }).join(" · ") + '</span></a></div>';
  }
  function renderSelectedTargets() {
    var selected = Array.from(selectedTargets.values()).map(function (item) { return item.target; });
    var targets = selected.filter(function (target) { return targetMatchesFor(target, "selected"); });
    byId("selected-result-count").textContent = targets.length + " / " + selected.length;
    byId("selected-grid").innerHTML = targets.length ? targets.map(targetRow).join("") : '<p class="empty-state">条件に一致する選択済みタンパク質がありません。</p>';
  }
  function renderTargets() {
    var targets = allTargets().filter(targetMatches);
    byId("target-result-count").textContent = targets.length + " / " + allTargets().length;
    byId("target-grid").innerHTML = targets.length ? targets.map(targetRow).join("") : '<p class="empty-state">条件に一致するタンパク質がありません。</p>';
  }
  function panelCard(panel) {
    var counts = panelCounts(panel);
    return '<a class="catalog-card panel-card" href="' + panelHref(panel.panel_id) + '"><h3>' + E(panel.display_name_ja || panel.short_name || panel.panel_name) + '</h3><p>' + E(panel.purpose || panel.description || '') + '</p><div class="status-counts">' + countHtml(counts) + '</div></a>';
  }
  function renderPanels() {
    var query = byId("panel-search").value.trim().toLowerCase();
    var panels = C.data.panels.filter(function (panel) { return !query || [panel.panel_name, panel.short_name, panel.category, panel.purpose].join(" ").toLowerCase().indexOf(query) !== -1; });
    var groups = new Map();
    panels.sort(function (a, b) { var aParent = a.parent_panel_id ? 1 : 0, bParent = b.parent_panel_id ? 1 : 0; return aParent - bParent || Number(a.display_order || 0) - Number(b.display_order || 0); });
    panels.forEach(function (panel) { var key = panel.category || "Other"; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(panel); });
    byId("panel-result-count").textContent = panels.length + " / " + C.data.panels.length;
    var topLevel = panels.filter(function (panel) { return !panel.parent_panel_id; });
    var topBlock = topLevel.length ? '<section class="panel-group panel-group--top"><h2>大きな機能グループ</h2><div class="catalog-grid catalog-grid--panels">' + topLevel.map(panelCard).join("") + '</div></section>' : '';
    var childBlocks = Array.from(groups.entries()).map(function (entry) { var children = entry[1].filter(function (panel) { return !!panel.parent_panel_id; }); return children.length ? '<section class="panel-group"><h2>' + E(entry[0]) + '</h2><div class="catalog-grid catalog-grid--panels">' + children.map(panelCard).join("") + '</div></section>' : ''; }).join("");
    byId("panel-groups").innerHTML = topBlock + childBlocks || '<p class="empty-state">条件に一致する経路・機能がありません。</p>';
  }
  function renderTargetDetail(target) {
    window.currentDetailTarget = target;
    showView("target-detail-view");
    byId("target-detail-symbol").textContent = target.gene_symbol;
    byId("target-detail-name").textContent = target.protein_name;
    byId("target-detail-status").innerHTML = statusBadge(target.measurement_status, true);
    byId("target-detail-summary").textContent = target.public_note || (target.category + "に関連するタンパク質です。");
    byId("target-detail-fields").innerHTML = '<div class="detail-field"><dt>遺伝子名</dt><dd>' + E(target.gene_name || "未指定") + '</dd></div><div class="detail-field"><dt>代表別名</dt><dd>' + E(target.display_aliases || "未指定") + '</dd></div><div class="detail-field"><dt>UniProt</dt><dd>' + E(target.canonical_uniprot_id || "未指定") + '</dd></div><div class="detail-field"><dt>HGNC</dt><dd>' + E(target.hgnc_id || "未指定") + '</dd></div><div class="detail-field"><dt>NCBI Gene</dt><dd>' + E(target.ncbi_gene_id || "未指定") + '</dd></div><div class="detail-field"><dt>Ensembl Gene</dt><dd>' + E(target.ensembl_gene_id || "未指定") + '</dd></div><div class="detail-field"><dt>KEGG Gene</dt><dd>' + E(target.kegg_gene_id || "未指定") + '</dd></div><div class="detail-field"><dt>主要カテゴリ</dt><dd>' + E(target.category) + '</dd></div>' + (target.sample_type && target.sample_type !== "未指定" ? '<div class="detail-field"><dt>対応試料</dt><dd>' + E(target.sample_type) + '</dd></div>' : '');
    var panels = locationPanelsForTarget(target);
    var isoforms = isoformsForTarget(target);
    byId("target-isoform-section").hidden = !isoforms.length;
    byId("target-isoforms").innerHTML = isoforms.map(function (item) { return '<div><strong>' + E(isoformDisplayName(item, target)) + '</strong><small>UniProt: ' + E(item.isoform_id) + ' · ' + E(isoformMeasurementLabel(item)) + '</small>' + (item.uniprot_isoform_name ? '<em>' + E(item.uniprot_isoform_name) + '</em>' : '') + '</div>'; }).join("");
    var related = target.virtual ? [] : C.relatedTargets(target.target_id);
    byId("target-related").innerHTML = related.length ? related.slice(0, 8).map(targetLink).join("") + (related.length > 8 ? '<button type="button" class="text-action" data-show-related>すべて表示 (' + related.length + ')</button><span class="all-related" hidden>' + related.slice(8).map(targetLink).join("") + '</span>' : '') : '<span class="muted">関連するタンパク質は登録されていません。</span>';
    var directPanels = panelsForTarget(target), locations = [], directIds = new Set(directPanels.map(function (panel) { return panel.panel_id; }));
    panels.forEach(function (panel) {
      var map = C.mapForPanel(panel.panel_id), detail = "上位グループ";
      (map ? map.nodes : []).forEach(function (node) {
        var matches = target.virtual ? node.node_id === target.node.node_id : node.target_id === target.target_id;
        if (matches) detail = node.module || "経路上の位置";
      });
      var label = panel.display_name_ja || panel.short_name || panel.panel_name;
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
    function addChildren(parent) { C.childrenOfPanel(parent.panel_id).forEach(function (child) { if (panelSeen.has(child.panel_id)) return; panelSeen.add(child.panel_id); panels.push(child); addChildren(child); }); }
    if (panel.panel_type === "umbrella") addChildren(panel);
    panels.forEach(function (item) { C.membersForPanel(item.panel_id).forEach(function (member) { if (!member.target || seen.has(member.target_id)) return; seen.add(member.target_id); rows.push({ id: member.target_id, label: member.target.gene_symbol, target: member.target }); }); });
    var map = C.mapForPanel(panel.panel_id);
    (map ? map.nodes : []).forEach(function (node) { if (node.node_type !== "protein" || node.target_id || seen.has(node.node_id)) return; seen.add(node.node_id); rows.push({ id: "virtual/" + node.node_id, label: node.label, target: targetById("virtual/" + node.node_id), node: node }); });
    return rows.sort(function (a, b) { return a.label.localeCompare(b.label); });
  }
  function renderPanelTargets(panel) {
    var rows = panelRows(panel).filter(function (row) { var status = row.target ? C.publicState(row.target.measurement_status, !row.target.virtual) : "not_registered"; return !!visibleStatuses[status]; });
    byId("panel-target-list").innerHTML = rows.map(function (row) { var value = row.target ? row.target.measurement_status : "not_registered"; var href = row.target && !row.target.virtual ? targetHref(row.id) : "#"; var linkOpen = href === "#" ? '<span class="panel-target-link" data-target-link="#">' : '<a class="panel-target-link" href="' + E(href) + '" data-target-link="' + E(href) + '">'; var linkClose = href === "#" ? '</span>' : '</a>'; return '<div class="panel-target-row panel-target-row--' + C.publicState(value, !!row.target && !row.target.virtual) + '"><span class="target-select-column" data-no-row-link><span class="target-select-box"><input type="checkbox" data-selection-check="' + E(row.target ? row.target.target_id : row.id) + '" data-selection-panel="' + E(panel.panel_id) + '" aria-label="' + E(row.label) + 'を測定対象に含める"' + (row.target && selected(row.target) ? ' checked' : '') + '></span></span>' + linkOpen + '<strong>' + E(row.label) + '</strong>' + statusBadge(value, !!row.target && !row.target.virtual) + linkClose + '</div>'; }).join("") || '<p class="muted">表示対象のタンパク質はありません。</p>';
    document.querySelectorAll("[data-status-filter]").forEach(function (button) { var status = button.dataset.statusFilter; button.setAttribute("aria-pressed", String(!!visibleStatuses[status])); });
    var bulk = document.querySelector("[data-panel-select]"), exclude = document.querySelector("[data-panel-exclude-unregistered]");
    if (bulk) bulk.textContent = "表示されているものを追加";
    if (exclude) exclude.textContent = "測定例無しのたんぱくを除外";
  }
  function renderPanelDetail(panel) {
    showView("panel-detail-view");
    byId("panel-detail-title").textContent = panel.display_name_ja || panel.short_name || panel.panel_name;
    byId("panel-detail-purpose").textContent = panel.purpose || "";
    byId("panel-detail-description").textContent = panel.description || "";
    byId("panel-status-counts").innerHTML = countHtml(panelCounts(panel));
    byId("panel-relations").innerHTML = "";
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
    var savedScroll = scrollPositions.get(location.hash);
    window.scrollTo(0, savedScroll == null ? 0 : savedScroll);
    var route = C.parseHash(location.hash);
    if (route.view === "target") { var target = targetById(route.id); if (target) renderTargetDetail(target); else { showView("targets-view"); renderTargets(); } }
    else if (route.view === "panel") { var panel = C.panelById(route.id); if (panel) renderPanelDetail(panel); else { showView("panels-view"); renderPanels(); } }
    else if (route.view === "panels") { showView("panels-view"); renderPanels(); }
    else if (route.view === "selected") { showView("selected-targets-view"); renderSelectedTargets(); }
    else { showView("targets-view"); renderTargets(); }
    syncTabs();
  }
  function populateMultiFilter(id, label, options) {
    var host = byId(id), optionsHost = host.querySelector("[data-filter-options]");
    host.dataset.filterLabel = label;
    optionsHost.innerHTML = options.map(function (option) { return '<label><input type="checkbox" value="' + E(option.value) + '">' + E(option.label) + '</label>'; }).join("");
    updateFilterSummary(host);
  }
  function populateFilters() {
    var statuses = [{ value: "measured", label: "● 測定実績あり" }, { value: "candidate", label: "▲ 測定候補" }, { value: "not_registered", label: "□ 測定例なし" }];
    var categories = Array.from(new Set(allTargets().map(function (target) { return target.category; }).filter(Boolean))).sort().map(function (value) { return { value: value, label: value }; });
    var panels = C.data.panels.map(function (panel) { return { value: panel.panel_id, label: panel.display_name_ja || panel.short_name || panel.panel_name }; });
    ["target-status-filter", "selected-status-filter"].forEach(function (id) { populateMultiFilter(id, "測定状態", statuses); });
    ["target-category-filter", "selected-category-filter"].forEach(function (id) { populateMultiFilter(id, "カテゴリ", categories); });
    ["target-panel-filter", "selected-panel-filter"].forEach(function (id) { populateMultiFilter(id, "経路・機能", panels); });
  }
  document.addEventListener("change", function (event) {
    var check = event.target.closest("[data-selection-check]");
    if (!check) return;
    var target = targetById(check.dataset.selectionCheck);
    if (!target) return;
    rememberSelectionCheck(check);
    if (check.checked) addSelection(target, check.dataset.selectionPanel || null, !!target.virtual); else removeSelection(target.target_id);
    renderSelection(false);
  });
  document.addEventListener("click", function (event) {
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
        var table = columnCheck.closest(".target-table");
        var isRange = event.shiftKey && table && lastSelectionTable === table && lastSelectionCheckId;
        event.preventDefault();
        if (isRange) selectCheckRange(columnCheck, !columnCheck.checked);
        else setSelectionState(columnCheck, !columnCheck.checked);
        rememberSelectionCheck(columnCheck);
        renderSelection(false);
      }
      return;
    }
    var internalLink = event.target.closest('a[href^="#"]');
    if (internalLink) scrollPositions.set(location.hash, window.scrollY);
    var rowLink = event.target.closest("[data-target-link]");
    if (rowLink) { var textSelection = window.getSelection ? window.getSelection() : null; if (textSelection && !textSelection.isCollapsed) return; event.preventDefault(); var href = rowLink.dataset.targetLink; if (href && href !== "#") { scrollPositions.set(location.hash, window.scrollY); location.hash = href.slice(1); } return; }
    var allRelated = event.target.closest("[data-show-related]");
    if (allRelated) { allRelated.hidden = true; allRelated.nextElementSibling.hidden = false; }
    var check = event.target.closest("[data-selection-check]");
    if (check) { event.stopPropagation(); return; }
    var selectionCell = event.target.closest("[data-no-row-link]");
    if (selectionCell) { event.preventDefault(); event.stopPropagation(); return; }
    var remove = event.target.closest("[data-remove-selection]");
    if (remove) { removeSelection(remove.dataset.removeSelection); renderSelection(); return; }
    var targetToggle = event.target.closest("#target-selection-toggle");
    if (targetToggle) { event.preventDefault(); toggleSelection(window.currentDetailTarget, null, !!window.currentDetailTarget.virtual); return; }
    var statusFilter = event.target.closest("[data-status-filter]");
    if (statusFilter) { event.preventDefault(); var statusKey = statusFilter.dataset.statusFilter; visibleStatuses[statusKey] = !visibleStatuses[statusKey]; var statusRoute = C.parseHash(location.hash); var statusPanel = statusRoute.view === "panel" ? C.panelById(statusRoute.id) : null; if (statusPanel) renderPanelTargets(statusPanel); return; }
    var bulk = event.target.closest("[data-panel-select]");
    if (bulk) { event.preventDefault(); var bulkRoute = C.parseHash(location.hash), bulkPanel = bulkRoute.view === "panel" ? C.panelById(bulkRoute.id) : null; if (bulkPanel) { eligiblePanelRows(bulkPanel).forEach(function (row) { addSelection(row.target, bulkPanel.panel_id, !!row.target.virtual); }); renderPanelTargets(bulkPanel); renderSelection(); } return; }
    var exclude = event.target.closest("[data-panel-exclude-unregistered]");
    if (exclude) { event.preventDefault(); var excludeRoute = C.parseHash(location.hash), excludePanel = excludeRoute.view === "panel" ? C.panelById(excludeRoute.id) : null; if (excludePanel) { panelRows(excludePanel).forEach(function (row) { if (!row.target || !row.target.virtual) return; var item = selectedTargets.get(row.target.target_id); if (!item) return; item.source_group_ids = (item.source_group_ids || []).filter(function (id) { return id !== excludePanel.panel_id; }); if (!item.source_group_ids.length) removeSelection(row.target.target_id); }); renderPanelTargets(excludePanel); renderSelection(); } return; }
    var selectionToggle = event.target.closest("#selection-toggle");
    if (selectionToggle) { var drawer = byId("selection-drawer"); drawer.hidden = !drawer.hidden; selectionToggle.setAttribute("aria-expanded", String(!drawer.hidden)); return; }
    if (event.target.closest("#selection-close")) { byId("selection-drawer").hidden = true; return; }
    if (event.target.closest("#selection-clear")) { selectedTargets.clear(); renderSelection(); return; }
    if (event.target.closest("#selection-json")) { downloadSelection("json"); return; }
    if (event.target.closest("#selection-csv")) { downloadSelection("csv"); return; }
  });
  document.addEventListener("DOMContentLoaded", function () {
    populateFilters();
    renderSelection();
    byId("target-total").textContent = allTargets().length;
    byId("panel-total").textContent = C.data.panels.length;
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
