(function () {
  "use strict";

  var C = window.CatalogCore;
  var E = C.escapeHtml;
  var views = ["targets-view", "selected-targets-view", "panels-view", "target-detail-view", "panel-detail-view"];
  var visibleStatuses = { measured: true, candidate: true, not_registered: true };
  var selectedTargets = new Map();
  var scrollPositions = new Map();
  var lastSelectionCheckId = null;
  var lastSelectionTable = null;

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

  function selectionSourceIds(target) { return panelsForTarget(target).map(function (panel) { return panel.panel_id; }); }
  function selected(target) { return selectedTargets.has(target.target_id); }
  function addSelection(target, sourceGroupId, developmentOnly) {
    if (!target) return;
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
    if (shouldSelect) addSelection(target, check.dataset.selectionPanel || null, target.measurement_state === "not_registered"); else removeSelection(target.target_id);
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
    return panelRows(panel).filter(function (row) { if (!row.target) return false; var status = C.publicState(row.target.measurement_state || row.target.measurement_status, true); return !!visibleStatuses[status]; });
  }
  function panelFullySelected(panel) { var rows = eligiblePanelRows(panel); return rows.length > 0 && rows.every(function (row) { return selected(row.target) && (selectedTargets.get(row.target.target_id).source_group_ids || []).indexOf(panel.panel_id) !== -1; }); }
  function selectionPayload() { return { schema: "targeted-proteomics-selection/1.1", selected_targets: Array.from(selectedTargets.values()).map(function (item) { var target = item.target; var state = target.measurement_state || C.publicState(target.measurement_status, true); return { target_id: target.target_id, gene_symbol: target.gene_symbol, uniprot_id: target.canonical_uniprot_id || "", measurement_status: target.measurement_status || "", measurement_state: state, request_type: state === "not_registered" ? "assay_development" : "measurement", selection_type: state === "not_registered" ? "development" : "registered", source_group_ids: item.source_group_ids }; }) }; }
  function downloadSelection(type) {
    var payload = selectionPayload(), stamp = new Date().toISOString().slice(0, 10), blob, name;
    if (type === "json") { blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }); name = "selected-targets-" + stamp + ".json"; }
    else { var rows = ["target_id,gene_symbol,uniprot_id,measurement_status,measurement_state,request_type,source_group_ids"].concat(payload.selected_targets.map(function (row) { return [row.target_id, row.gene_symbol, row.uniprot_id, row.measurement_status, row.measurement_state, row.request_type, row.source_group_ids.join(";")].map(function (value) { return '"' + String(value).replace(/"/g, '""') + '"'; }).join(","); })); blob = new Blob(["\ufeff" + rows.join("\n")], { type: "text/csv;charset=utf-8" }); name = "selected-targets-" + stamp + ".csv"; }
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
  function statusBadge(value, registered, extraStyle) {
    var state = C.publicState(value, registered);
    var styleAttr = extraStyle ? ' style="' + E(extraStyle) + '"' : '';
    return '<span class="status status--' + state.replace("not_registered", "unregistered") + '"' + styleAttr + '><b aria-hidden="true">' + C.statusSymbol(value, registered) + '</b> ' + E(C.statusLabel(value, registered)) + '</span>';
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
  function targetLink(target) { return '<a class="related-target-row" href="' + targetHref(target.target_id) + '"><strong>' + E(target.gene_symbol) + '</strong>' + statusBadge(target.measurement_status, true, "justify-self: start; width: fit-content;") + '</a>'; }

  function panelCounts(panel) {
    var counts = { measured: 0, candidate: 0, not_registered: 0 };
    var rows = panelRows(panel);
    rows.forEach(function (row) {
      if (!row.target) return;
      var state = C.publicState(row.target.measurement_state || row.target.measurement_status, true);
      if (state === "measured") counts.measured += 1;
      else if (state === "candidate") counts.candidate += 1;
      else counts.not_registered += 1;
    });
    return counts;
  }
  function countHtml(counts) { return '<div class="status-count-item count-measured"><span>● 測定実績あり</span><b>' + counts.measured + '</b></div><div class="status-count-item count-candidate"><span>▲ 測定候補</span><b>' + counts.candidate + '</b></div><div class="status-count-item count-unregistered"><span>□ 登録測定系なし</span><b>' + counts.not_registered + '</b></div>'; }

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
      target.kegg_gene_id,
      target.detail_groups,
      target.pathway_tags,
      target.previous_symbols || "",
      isoformText
    ].join(" ").toLowerCase();

    var targetCategories = (target.category || "").split(";").map(function (s) { return s.trim(); }).filter(Boolean);
    var categoryMatch = !categories.length || categories.some(function (c) { return targetCategories.indexOf(c) !== -1; });

    return (!queryTerms.length || queryTerms.every(function (term) { return haystack.indexOf(term) !== -1; })) &&
           (!states.length || states.indexOf(state) !== -1) &&
           categoryMatch &&
           (!panelIds.length || panelsForTarget(target).some(function (panel) { return panelIds.indexOf(panel.panel_id) !== -1; })) &&
           (!isoformOnly || isoformsForTarget(target).length > 0);
  }
  function targetMatches(target) { return targetMatchesFor(target, "target"); }
  function targetRow(target) {
    var isoforms = isoformsForTarget(target);
    var panels = panelsForTarget(target).slice(0, 2);
    return '<div class="target-row" role="row"><span class="target-select-column" data-no-row-link><span class="target-select-box"><input type="checkbox" data-selection-check="' + E(target.target_id) + '" aria-label="' + E(target.gene_symbol) + 'を測定対象に含める"' + (selected(target) ? ' checked' : '') + '></span></span><a class="target-row-link" href="' + E(targetHref(target.target_id)) + '" data-target-link="' + E(targetHref(target.target_id)) + '"><span>' + statusBadge(target.measurement_state || target.measurement_status, true) + '</span><strong class="target-gene">' + E(target.gene_symbol) + '</strong><span class="target-protein-name">' + E(target.protein_name || '') + '</span><span class="target-isoform-cell">' + (isoforms.length ? E(isoforms.map(function (item) { return isoformDisplayName(item, target); }).join(" / ")) : '') + '</span><span class="target-pathways">' + panels.map(function (panel) { return E(panel.display_name_ja) + ' (' + E(panel.display_name_en) + ')'; }).join(" · ") + '</span></a></div>';
  }
  function renderSelectedTargets() {
    var selected = Array.from(selectedTargets.values()).map(function (item) { return item.target; });
    var targets = selected.filter(function (target) { return targetMatchesFor(target, "selected"); });
    byId("selected-result-count").textContent = targets.length + " / " + selected.length;
    byId("selected-grid").innerHTML = targets.length ? targets.map(targetRow).join("") : '<p class="empty-state">条件に一致する選択済みタンパク質がありません。</p>';
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
  function panelCard(panel) {
    var counts = panelCounts(panel);
    var nameHtml = E(panel.display_name_ja || panel.short_name || panel.panel_name);
    if (panel.display_name_en && panel.display_name_en !== panel.display_name_ja) {
      nameHtml += '<br><span class="panel-card-en" style="font-size: 19px; color: #283e56; font-weight: 700; display: block; margin-top: 5px; line-height: 1.2;">' + E(panel.display_name_en) + '</span>';
    }
    return '<a class="catalog-card panel-card" data-panel-id="' + E(panel.panel_id) + '" href="' + panelHref(panel.panel_id) + '"><h3>' + nameHtml + '</h3><p style="margin-top: 5px;">' + E(panel.description_ja || panel.purpose || panel.description || '') + '</p><div class="status-counts" style="margin-top: 10px;">' + countHtml(counts) + '</div></a>';
  }
  function renderPanels() {
    var query = byId("panel-search").value.trim().toLowerCase();
    var panels = C.data.panels.filter(function (panel) { return !query || [panel.display_name_ja, panel.display_name_en, panel.purpose, panel.description_ja].join(" ").toLowerCase().indexOf(query) !== -1; });

    var groups = new Map();
    var domainPanels = C.data.panels.filter(function (p) { return p.catalog_group_type === "domain"; });
    domainPanels.forEach(function (dp) { groups.set(dp.display_name_ja, []); });

    panels.forEach(function (panel) {
      if (panel.catalog_group_type === "domain") return;
      var parent = panel.parent_panel_id ? C.panelById(panel.parent_panel_id) : null;
      var groupKey = parent ? parent.display_name_ja : "その他";
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(panel);
    });

    byId("panel-result-count").textContent = panels.length + " / " + C.data.panels.length;
    var topLevel = C.data.panels.filter(function (panel) { return panel.catalog_group_type === "domain"; });
    var topBlock = topLevel.length ? '<section id="panel-domain-groups" class="panel-group panel-group--top"><h2>大分類</h2><div class="catalog-grid catalog-grid--panels">' + topLevel.map(panelCard).join("") + '</div></section>' : '';
    var childBlocks = Array.from(groups.entries()).map(function (entry) {
      var groupName = entry[0];
      var children = entry[1];
      if (groupName === "その他" && !children.length) return '';
      return children.length ? '<section class="panel-group"><h2>' + E(groupName) + '</h2><div class="catalog-grid catalog-grid--panels">' + children.map(panelCard).join("") + '</div></section>' : '';
    }).join("");
    byId("panel-groups").innerHTML = topBlock + childBlocks || '<p class="empty-state">条件に一致する経路・機能がありません。</p>';
  }
  function renderTargetDetail(target) {
    window.currentDetailTarget = target;
    showView("target-detail-view");
    byId("target-detail-symbol").textContent = target.gene_symbol;
    byId("target-detail-name").textContent = target.protein_name;
    byId("target-detail-status").innerHTML = statusBadge(target.measurement_status, true, "width: fit-content;");
    byId("target-detail-summary").textContent = target.public_note || "詳細情報";

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
      '<div class="detail-field"><dt>HGNC</dt><dd>' + E(target.hgnc_id || "未指定") + '</dd></div>' +
      '<div class="detail-field"><dt>NCBI Gene</dt><dd>' + E(target.ncbi_gene_id || "未指定") + '</dd></div>' +
      '<div class="detail-field"><dt>Ensembl Gene</dt><dd>' + E(target.ensembl_gene_id || "未指定") + '</dd></div>' +
      '<div class="detail-field"><dt>KEGG Gene</dt><dd>' + E(target.kegg_gene_id || "未指定") + '</dd></div>' +
      (target.sample_type && target.sample_type !== "未指定" ? '<div class="detail-field"><dt>対応試料</dt><dd>' + E(target.sample_type) + '</dd></div>' : '');

    var isoforms = isoformsForTarget(target);
    byId("target-isoform-section").hidden = !isoforms.length;
    byId("target-isoforms").innerHTML = isoforms.map(function (item) { return '<div><strong>' + E(isoformDisplayName(item, target)) + '</strong><small>UniProt: ' + E(item.isoform_id) + ' · ' + E(isoformMeasurementLabel(item)) + '</small>' + (item.uniprot_isoform_name ? '<em>' + E(item.uniprot_isoform_name) + '</em>' : '') + '</div>'; }).join("");
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
    var rows = panelRows(panel).filter(function (row) { var status = row.target ? C.publicState(row.target.measurement_state || row.target.measurement_status, true) : "not_registered"; return !!visibleStatuses[status]; });
    byId("panel-target-list").innerHTML = rows.map(function (row) { var value = row.target ? (row.target.measurement_state || row.target.measurement_status) : "not_registered"; var href = row.target ? targetHref(row.id) : "#"; var linkOpen = href === "#" ? '<span class="panel-target-link" data-target-link="#">' : '<a class="panel-target-link" href="' + E(href) + '" data-target-link="' + E(href) + '">'; var linkClose = href === "#" ? '</span>' : '</a>'; return '<div class="panel-target-row panel-target-row--' + C.publicState(value, true) + '"><span class="target-select-column" data-no-row-link><span class="target-select-box"><input type="checkbox" data-selection-check="' + E(row.target ? row.target.target_id : row.id) + '" data-selection-panel="' + E(panel.panel_id) + '" aria-label="' + E(row.label) + 'を測定対象に含める"' + (row.target && selected(row.target) ? ' checked' : '') + '></span></span>' + linkOpen + '<strong>' + E(row.label) + '</strong>' + statusBadge(value, true) + linkClose + '</div>'; }).join("") || '<p class="muted">表示対象のタンパク質はありません。</p>';
    document.querySelectorAll("[data-status-filter]").forEach(function (button) { var status = button.dataset.statusFilter; button.setAttribute("aria-pressed", String(!!visibleStatuses[status])); });
    var bulk = document.querySelector("[data-panel-select]"), exclude = document.querySelector("[data-panel-exclude-unregistered]");
    if (bulk) bulk.textContent = "表示されているものを追加";
    if (exclude) exclude.textContent = "登録測定系なしのタンパク質を除外";
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
    var savedScroll = scrollPositions.get(location.hash);
    window.scrollTo(0, savedScroll == null ? 0 : savedScroll);
    var route = C.parseHash(location.hash);
    if (route.view === "target") { var target = targetById(route.id); if (target) renderTargetDetail(target); else { showView("targets-view"); renderTargets(); } }
    else if (route.view === "panel") { var panel = C.panelById(route.id); if (panel) renderPanelDetail(panel); else { showView("panels-view"); renderPanels(); } }
    else if (route.view === "panels") { showView("panels-view"); renderPanels(); }
    else if (route.view === "selected") { showView("selected-targets-view"); renderSelectedTargets(); }
    else { showView("targets-view"); renderTargets(); }
    syncTabs();
    if (shouldRestoreCatalogPosition()) requestAnimationFrame(function () { requestAnimationFrame(restoreCatalogPosition); });
  }
  function populateMultiFilter(id, label, options) {
    var host = byId(id), optionsHost = host.querySelector("[data-filter-options]");
    host.dataset.filterLabel = label;
    optionsHost.innerHTML = options.map(function (option) { return '<label><input type="checkbox" value="' + E(option.value) + '">' + E(option.label) + '</label>'; }).join("");
    updateFilterSummary(host);
  }
  function populateFilters() {
    var statuses = [{ value: "measured", label: "● 測定実績あり" }, { value: "candidate", label: "▲ 測定候補" }, { value: "not_registered", label: "□ 測定例なし" }];

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
    var check = event.target.closest("[data-selection-check]");
    if (!check) return;
    var target = targetById(check.dataset.selectionCheck);
    if (!target) return;
    rememberSelectionCheck(check);
    if (check.checked) addSelection(target, check.dataset.selectionPanel || null, target.measurement_state === "not_registered"); else removeSelection(target.target_id);
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
    if (internalLink) {
      var sourceRoute = C.parseHash(location.hash);
      if (sourceRoute.view !== "target") rememberCurrentScroll();
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
    var remove = event.target.closest("[data-remove-selection]");
    if (remove) { removeSelection(remove.dataset.removeSelection); renderSelection(); return; }
    var targetToggle = event.target.closest("#target-selection-toggle");
    if (targetToggle) { event.preventDefault(); toggleSelection(window.currentDetailTarget, null, window.currentDetailTarget.measurement_state === "not_registered"); return; }
    var statusFilter = event.target.closest("[data-status-filter]");
    if (statusFilter) { event.preventDefault(); var statusKey = statusFilter.dataset.statusFilter; visibleStatuses[statusKey] = !visibleStatuses[statusKey]; var statusRoute = C.parseHash(location.hash); var statusPanel = statusRoute.view === "panel" ? C.panelById(statusRoute.id) : null; if (statusPanel) renderPanelTargets(statusPanel); return; }
    var bulk = event.target.closest("[data-panel-select]");
    if (bulk) { event.preventDefault(); var bulkRoute = C.parseHash(location.hash), bulkPanel = bulkRoute.view === "panel" ? C.panelById(bulkRoute.id) : null; if (bulkPanel) { eligiblePanelRows(bulkPanel).forEach(function (row) { addSelection(row.target, bulkPanel.panel_id, row.target.measurement_state === "not_registered"); }); renderPanelTargets(bulkPanel); renderSelection(); } return; }
    var exclude = event.target.closest("[data-panel-exclude-unregistered]");
    if (exclude) { event.preventDefault(); var excludeRoute = C.parseHash(location.hash), excludePanel = excludeRoute.view === "panel" ? C.panelById(excludeRoute.id) : null; if (excludePanel) { panelRows(excludePanel).forEach(function (row) { if (!row.target || row.target.measurement_state !== "not_registered") return; var item = selectedTargets.get(row.target.target_id); if (!item) return; item.source_group_ids = (item.source_group_ids || []).filter(function (id) { return id !== excludePanel.panel_id; }); if (!item.source_group_ids.length) removeSelection(row.target.target_id); }); renderPanelTargets(excludePanel); renderSelection(); } return; }
    var selectionToggle = event.target.closest("#selection-toggle");
    if (selectionToggle) { var drawer = byId("selection-drawer"); drawer.hidden = !drawer.hidden; selectionToggle.setAttribute("aria-expanded", String(!drawer.hidden)); return; }
    var scrollTo = event.target.closest("[data-scroll-to]");
    if (scrollTo) { event.preventDefault(); var destination = byId(scrollTo.dataset.scrollTo); if (destination) destination.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (event.target.closest("#selection-close")) { byId("selection-drawer").hidden = true; return; }
    if (event.target.closest("#selection-clear")) { selectedTargets.clear(); renderSelection(); return; }
    if (event.target.closest("#selection-json") || event.target.closest("#selection-page-json")) { downloadSelection("json"); return; }
    if (event.target.closest("#selection-csv") || event.target.closest("#selection-page-csv")) { downloadSelection("csv"); return; }
  });
  window.CatalogNavigation = { rememberScroll: rememberCurrentScroll };
  document.addEventListener("DOMContentLoaded", function () {
    populateFilters();
    renderSelection();
    byId("target-total").textContent = allTargets().filter(function(t) { return t.record_type !== "external_control"; }).length;
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
