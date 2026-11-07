// Multi Medicos Enterprise Management Module
// Integrated Suppliers, Purchasing, Batch Inventory, Khata, Expenses & Reports

$(document).ready(function () {
  const Store = require("electron-store");
  const notiflix = require("notiflix");
  const moment = require("moment");
  let DOMPurify;
  try {
    const _dp = require("dompurify");
    DOMPurify = typeof _dp.sanitize === "function" ? _dp : (typeof window !== "undefined" ? _dp(window) : _dp);
  } catch (_) {
    DOMPurify = { sanitize: (s) => String(s || "") };
  }
  if (!DOMPurify || typeof DOMPurify.sanitize !== "function") {
    DOMPurify = { sanitize: (s) => String(s || "") };
  }
  const storage = new Store();
  const getPort = () => process.env.PORT || "3210";
  const getApiUrl = (endpoint) => `http://localhost:${getPort()}/api/${endpoint}`;

  function getAuthToken() {
    try {
      const session = storage.get("auth");
      if (session && session.token) return session.token;
      const user = storage.get("user");
      return user && user.token ? user.token : "";
    } catch {
      return "";
    }
  }

  function apiAjax(endpoint, options = {}) {
    const token = getAuthToken();
    const defaults = {
      url: getApiUrl(endpoint),
      headers: token ? { "X-Access-Token": token } : {},
      contentType: "application/json; charset=utf-8"
    };
    return $.ajax(Object.assign({}, defaults, options));
  }

  function formatMoney(amount) {
    const num = Number(amount) || 0;
    return "PKR " + num.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>'"]/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character];
    });
  }

  function karachiDate() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    const value = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  }

  // ==========================================
  // NAVIGATION & TAB SWITCHING
  // ==========================================

  $(document).on("click", ".nav-tab", function () {
    const viewName = $(this).data("view");
    $(".nav-tab").removeClass("active");
    $(this).addClass("active");

    $(".enterprise-view").hide();
    $("#transactions_view").hide();

    if (viewName === "pos") {
      $("#pos_view").show();
      $("#pointofsale").hide();
      $("#transactions").show();
    } else {
      $("#pos_view").hide();
      $("#transactions").show();
      $("#pointofsale").show();

      $(`#${viewName}_view`).show();

      switch (viewName) {
        case "dashboard":
          loadDashboard();
          break;
        case "purchases":
          loadPurchases();
          break;
        case "suppliers":
          loadSuppliers();
          break;
        case "customers_khata":
          loadCustomersKhata();
          break;
        case "expenses":
          loadExpenses();
          break;
        case "reports":
          loadReports();
          break;
      }
    }
  });

  // ==========================================
  // 1. DASHBOARD
  // ==========================================

  function loadDashboard() {
    apiAjax("ledger/dashboard-summary", { type: "GET" })
      .done(function (data) {
        $("#dash_receivables").text(formatMoney(data.total_receivables));
        $("#dash_payables").text(formatMoney(data.total_payables));
        $("#dash_cash").text(formatMoney(data.cash_balance));
        $("#dash_collections").text(formatMoney(data.today_collections));
        $("#dash_supplier_payments").text(formatMoney(data.today_supplier_payments));
        $("#dash_expenses").text(formatMoney(data.today_expenses));
        $("#dash_overdue").text(data.overdue_invoices_count);
      })
      .fail(function (xhr) {
        console.error("Dashboard summary load failed:", xhr);
      });

    // Financial performance / Profit section (restricted to authorized roles)
    apiAjax("reports/dashboard-profit", { type: "GET" })
      .done(function (res) {
        renderDashboardProfit(res);
      })
      .fail(function (xhr) {
        // Cashiers / unauthorized roles get 403: hide profit section cleanly
        $("#dash_profit_section").hide();
      });
  }

  function calculateNiceTicks(minVal, maxVal, maxTicks = 5) {
    if (minVal > 0) minVal = 0;
    if (maxVal < 0) maxVal = 0;
    if (maxVal === 0 && minVal === 0) {
      return { niceMin: 0, niceMax: 5000, step: 1000, ticks: [0, 1000, 2000, 3000, 4000, 5000] };
    }
    const rawRange = maxVal - minVal;
    const roughStep = rawRange / (maxTicks - 1);
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(1, roughStep))));
    const normalized = roughStep / magnitude;
    let stepFactor = 1;
    if (normalized > 5) stepFactor = 10;
    else if (normalized > 2) stepFactor = 5;
    else if (normalized > 1) stepFactor = 2;
    else stepFactor = 1;
    let step = stepFactor * magnitude;
    if (rawRange >= 2000 && step < 1000) step = 1000;
    const niceMin = Math.floor(minVal / step) * step;
    const niceMax = Math.ceil(maxVal / step) * step;
    const ticks = [];
    for (let v = niceMin; v <= niceMax + (step * 0.01); v += step) {
      ticks.push(Math.round(v));
    }
    return { niceMin, niceMax, step, ticks };
  }

  function renderDashboardProfit(data) {
    if (!data || !data.thisMonth) {
      $("#dash_profit_section").hide();
      return;
    }
    $("#dash_profit_section").show();

    const tm = data.thisMonth;
    $("#dash_month_sales").text(formatMoney(tm.sales));
    $("#dash_month_gross_profit").text(tm.grossProfit === "—" ? "—" : formatMoney(tm.grossProfit));
    $("#dash_month_expenses").text(formatMoney(tm.expenses));

    const $np = $("#dash_month_net_profit");
    if (tm.isIncomplete) {
      $np.html('<span style="color:var(--text-secondary, #64748b);">—</span> <span class="badge" style="background:#fef3c7; color:#92400e; font-size:11px; vertical-align:middle;">Incomplete</span>');
    } else {
      const npVal = Number(tm.netProfitCents || 0);
      if (npVal < 0) {
        $np.text("-" + formatMoney(Math.abs(npVal) / 100)).css("color", "#ef4444");
      } else {
        $np.text(formatMoney(tm.netProfit)).css("color", "#10b981");
      }
    }

    function setBadge($el, change) {
      $el.text(change);
      if (change && change.startsWith("+")) {
        $el.css({ color: "#10b981", fontWeight: "600" });
      } else if (change && change.startsWith("-")) {
        $el.css({ color: "#ef4444", fontWeight: "600" });
      } else {
        $el.css({ color: "var(--text-secondary, #64748b)", fontWeight: "normal" });
      }
    }
    setBadge($("#dash_month_sales_change"), tm.salesChange || "—");
    setBadge($("#dash_month_gp_change"), tm.grossProfitChange || "—");
    setBadge($("#dash_month_exp_change"), tm.expensesChange || "—");
    setBadge($("#dash_month_np_change"), tm.netProfitChange || "—");

    if (tm.unknownCount > 0) {
      $("#dash_month_unknown_note")
        .html(`<i class="fa fa-info-circle"></i> <strong>Note:</strong> Cost unavailable for ${tm.unknownCount} sales (${formatMoney(tm.unknownAmount)}) (before cost tracking / no purchase cost). Net profit cannot be determined accurately until purchase bills are entered. Shown gross profit reflects sales with known cost.`)
        .show();
    } else {
      $("#dash_month_unknown_note").hide();
    }

    // Render Last 12 Months Table
    const $tbody = $("#dash_12m_tbody");
    $tbody.empty();
    const months = data.last12Months || [];
    months.slice().reverse().forEach(m => {
      const isLoss = !m.isIncomplete && Number(m.netProfitCents) < 0;
      let profitDisplay = formatMoney(m.netProfit);
      let profitClass = "text-success font-weight-bold";

      if (m.isIncomplete) {
        profitDisplay = '<span class="text-muted font-weight-bold">—</span> <span class="badge" style="background:#fef3c7; color:#92400e; font-size:10px;">Incomplete</span>';
        profitClass = "";
      } else if (isLoss) {
        profitDisplay = `-${formatMoney(Math.abs(Number(m.netProfitCents)) / 100)}`;
        profitClass = "text-danger font-weight-bold";
      }

      const noteBadge = m.unknownCount > 0
        ? ` <span class="badge" title="Cost unavailable for ${m.unknownCount} sales" style="background:#e0f2fe; color:#0369a1; font-size:10px;">${m.unknownCount} uncosted</span>`
        : "";

      const marginDisplay = m.isIncomplete || m.marginPct === null || m.marginPct === undefined ? "—" : `${m.marginPct}%`;

      $tbody.append(`
        <tr>
          <td><strong>${m.monthLabel}</strong>${noteBadge}</td>
          <td>${formatMoney(m.sales)}</td>
          <td>${m.cogs === "—" ? "—" : formatMoney(m.cogs)}</td>
          <td>${m.grossProfit === "—" ? "—" : formatMoney(m.grossProfit)}</td>
          <td>${formatMoney(m.expenses)}</td>
          <td class="${profitClass}">${profitDisplay}</td>
          <td>${marginDisplay}</td>
        </tr>
      `);
    });

    renderGroupedBarChart(months);
  }

  function renderGroupedBarChart(months) {
    const $svg = $("#dash_svg_chart");
    $svg.empty();
    if (!months || months.length === 0) return;

    const w = 900;
    const h = 240;
    const padLeft = 70;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 35;
    const chartW = w - padLeft - padRight;
    const chartH = h - padTop - padBottom;

    let maxVal = 0;
    let minVal = 0;
    months.forEach(m => {
      const s = Math.max(0, Number(m.salesCents || 0) / 100);
      const e = Math.max(0, Number(m.expensesCents || 0) / 100);
      maxVal = Math.max(maxVal, s, e);
      if (!m.isIncomplete && m.netProfitCents !== null) {
        const np = Number(m.netProfitCents || 0) / 100;
        maxVal = Math.max(maxVal, np);
        if (np < minVal) minVal = np;
      }
    });

    const nice = calculateNiceTicks(minVal, maxVal, 5);
    const range = Math.max(1, nice.niceMax - nice.niceMin);
    const y0 = padTop + ((nice.niceMax - 0) / range) * chartH;

    const svgNs = "http://www.w3.org/2000/svg";

    // Draw nice round grid lines & ticks
    nice.ticks.forEach(tickVal => {
      const y = padTop + ((nice.niceMax - tickVal) / range) * chartH;

      if (tickVal !== 0) {
        const line = document.createElementNS(svgNs, "line");
        line.setAttribute("x1", padLeft);
        line.setAttribute("y1", y);
        line.setAttribute("x2", w - padRight);
        line.setAttribute("y2", y);
        line.setAttribute("stroke", "var(--border-color, #e2e8f0)");
        line.setAttribute("stroke-dasharray", "3,3");
        line.setAttribute("opacity", "0.6");
        $svg[0].appendChild(line);
      }

      const text = document.createElementNS(svgNs, "text");
      text.setAttribute("x", padLeft - 8);
      text.setAttribute("y", y + 4);
      text.setAttribute("text-anchor", "end");
      text.setAttribute("font-size", "10");
      text.setAttribute("fill", "var(--text-secondary, #64748b)");
      text.textContent = tickVal.toLocaleString();
      $svg[0].appendChild(text);
    });

    // Zero baseline
    const baseLine = document.createElementNS(svgNs, "line");
    baseLine.setAttribute("x1", padLeft);
    baseLine.setAttribute("y1", y0);
    baseLine.setAttribute("x2", w - padRight);
    baseLine.setAttribute("y2", y0);
    baseLine.setAttribute("stroke", "var(--border-color, #94a3b8)");
    baseLine.setAttribute("stroke-width", "1.5");
    $svg[0].appendChild(baseLine);

    const colW = chartW / months.length;
    const barW = Math.max(4, Math.min(18, (colW - 14) / 3));

    months.forEach((m, idx) => {
      const colX = padLeft + idx * colW;
      const centerX = colX + colW / 2;

      const s = Math.max(0, Number(m.salesCents || 0) / 100);
      const e = Math.max(0, Number(m.expensesCents || 0) / 100);
      const np = Number(m.netProfitCents || 0) / 100;

      function drawBar(val, offsetIndex, color, isDotted = false, titleText = "") {
        const barH = (Math.abs(val) / range) * chartH;
        const x = centerX - (1.5 * barW) + (offsetIndex * barW);
        const y = val >= 0 ? y0 - Math.max(2, barH) : y0;

        const rect = document.createElementNS(svgNs, "rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", y);
        rect.setAttribute("width", Math.max(2, barW - 2));
        rect.setAttribute("height", Math.max(2, barH));
        if (isDotted) {
          rect.setAttribute("fill", "none");
          rect.setAttribute("stroke", "var(--border-color, #94a3b8)");
          rect.setAttribute("stroke-dasharray", "2,2");
          rect.setAttribute("stroke-width", "1.5");
        } else {
          rect.setAttribute("fill", color);
        }
        rect.setAttribute("rx", "2");

        const title = document.createElementNS(svgNs, "title");
        title.textContent = titleText || `${m.monthLabel}: PKR ${val.toFixed(2)}`;
        rect.appendChild(title);

        $svg[0].appendChild(rect);
      }

      drawBar(s, 0, "#3b82f6");
      drawBar(e, 1, "#f59e0b");

      if (m.isIncomplete) {
        // Draw dotted placeholder bar so incomplete state is clearly visible
        drawBar(Math.max(s * 0.1, 10), 2, "#94a3b8", true, `${m.monthLabel}: Net Profit Incomplete (${m.unknownCount} uncosted sales)`);
      } else if (m.netProfitCents !== null) {
        drawBar(np, 2, np >= 0 ? "#10b981" : "#ef4444");
      }

      const label = document.createElementNS(svgNs, "text");
      label.setAttribute("x", centerX);
      label.setAttribute("y", h - 10);
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("font-size", "10");
      label.setAttribute("fill", "var(--text-secondary, #64748b)");
      label.textContent = moment(m.month, "YYYY-MM").format("MMM");
      $svg[0].appendChild(label);
    });
  }

  $(document).on("click", "#btn_dash_view_pnl", function () {
    $('.nav-tab[data-view="reports"]').trigger("click");
    setTimeout(function () {
      $('.reports-menu [data-report="pnl"]').trigger("click");
    }, 50);
  });

  // ==========================================
  // 2. SUPPLIER MANAGEMENT
  // ==========================================

  let cachedSuppliers = [];
  let supplierReturnToPurchase = false;

  function loadSuppliers() {
    apiAjax("suppliers/all", { type: "GET" })
      .done(function (suppliers) {
        cachedSuppliers = suppliers;
        renderSuppliersTable(suppliers);
      })
      .fail(function (xhr) {
        notiflix.Report.failure("Error", xhr.responseJSON?.error || "Failed to load suppliers.", "Ok");
      });
  }

  function renderSuppliersTable(suppliers) {
    const $tbody = $("#suppliers_table_body");
    $tbody.empty();

    if (!suppliers || suppliers.length === 0) {
      $tbody.html('<tr><td colspan="7" class="text-center text-muted p-4">No suppliers found. Click "Add Supplier" to register one.</td></tr>');
      return;
    }

    suppliers.forEach(function (s) {
      const payableCents = Number(s.outstanding_payable_cents || 0);
      const payableClass = payableCents > 0 ? "money-positive" : "money-neutral";
      const statusBadge = s.status === "active" ? '<span class="badge-status badge-paid">Active</span>' : '<span class="badge-status badge-cancelled">Inactive</span>';

      const tr = `
        <tr>
          <td><strong>${s.id}</strong></td>
          <td><strong>${s.name}</strong><br><small class="text-muted">${s.contact_person || ""}</small></td>
          <td>${s.phone || "-"}<br><small class="text-muted">${s.email || ""}</small></td>
          <td>${s.payment_terms} (${s.due_period_days} days)</td>
          <td class="${payableClass}"><strong>${formatMoney(s.outstanding_payable)}</strong></td>
          <td>${statusBadge}</td>
          <td>
            <div class="btn-group btn-group-xs">
              <button class="btn btn-default btn-xs btn-view-statement" data-id="${s.id}" title="Statement"><i class="fa fa-file-text-o"></i> Statement</button>
              <button class="btn btn-success btn-xs btn-pay-supplier" data-id="${s.id}" title="Pay"><i class="fa fa-money"></i> Pay</button>
              <button class="btn btn-info btn-xs btn-edit-supplier" data-id="${s.id}" title="Edit"><i class="fa fa-pencil"></i></button>
            </div>
          </td>
        </tr>
      `;
      $tbody.append(tr);
    });
  }

  // Filter suppliers on search input
  $(document).on("input", "#supplier_search", function () {
    const q = $(this).val().toLowerCase();
    const filtered = cachedSuppliers.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.phone && s.phone.includes(q)) ||
      (s.contact_person && s.contact_person.toLowerCase().includes(q))
    );
    renderSuppliersTable(filtered);
  });

  // Open Add Supplier Modal
  $(document).on("click", "#btn_add_supplier", function () {
    if (!supplierReturnToPurchase) $("#modal_supplier").removeData("return-to-purchase");
    $("#form_supplier")[0].reset();
    $("#supplier_id_input").val("");
    $("#supplier_status_input").val("active");
    $("#supplier_terms_input").val("Net 30");
    $("#supplier_due_days_input").val("30");
    $("#supplier_additional_details").collapse("hide");
    $("#supplier_opening_balance_confirm").prop("checked", false);
    $("#supplier_opening_balance_input").val("").prop("disabled", true);
    $("#supplier_opening_balance_fields").hide();
    $("#supplier_opening_balance_group").show();
    $("#modal_supplier_title").text("Add New Supplier");
    $("#modal_supplier").modal("show");
  });

  $(document).on("change", "#supplier_opening_balance_confirm", function () {
    const enabled = $(this).is(":checked");
    $("#supplier_opening_balance_fields").toggle(enabled);
    $("#supplier_opening_balance_input").prop("disabled", !enabled);
    if (!enabled) $("#supplier_opening_balance_input").val("");
  });

  // Edit Supplier
  $(document).on("click", ".btn-edit-supplier", function () {
    const id = $(this).data("id");
    const supplier = cachedSuppliers.find(s => s.id === id);
    if (!supplier) return;

    $("#supplier_id_input").val(supplier.id);
    $("#supplier_name_input").val(supplier.name);
    $("#supplier_contact_input").val(supplier.contact_person);
    $("#supplier_phone_input").val(supplier.phone);
    $("#supplier_email_input").val(supplier.email);
    $("#supplier_address_input").val(supplier.address);
    $("#supplier_terms_input").val(supplier.payment_terms);
    $("#supplier_due_days_input").val(supplier.due_period_days);
    $("#supplier_status_input").val(supplier.status);
    $("#supplier_notes_input").val(supplier.notes);
    $("#supplier_additional_details").collapse("hide");

    // Opening balance cannot be changed on edit (must use opening balance adjustment)
    $("#supplier_opening_balance_group").hide();
    $("#modal_supplier_title").text("Edit Supplier: " + supplier.name);
    $("#modal_supplier").modal("show");
  });

  // Save Supplier Form
  $("#form_supplier").on("submit", function (e) {
    e.preventDefault();
    const id = $("#supplier_id_input").val();
    const isEdit = Boolean(id);

    const payload = {
      name: $("#supplier_name_input").val().trim(),
      contact_person: $("#supplier_contact_input").val().trim(),
      phone: $("#supplier_phone_input").val().trim(),
      email: $("#supplier_email_input").val().trim(),
      address: $("#supplier_address_input").val().trim(),
      payment_terms: $("#supplier_terms_input").val().trim(),
      due_period_days: $("#supplier_due_days_input").val() || 30,
      status: $("#supplier_status_input").val(),
      notes: $("#supplier_notes_input").val().trim(),
      opening_balance: !isEdit && $("#supplier_opening_balance_confirm").is(":checked")
        ? ($("#supplier_opening_balance_input").val() || 0)
        : 0
    };

    if (!payload.name) {
      notiflix.Report.warning("Supplier Name Required", "Enter the supplier name before saving.", "Ok");
      return;
    }
    if (Number(payload.opening_balance) < 0) {
      notiflix.Report.warning("Invalid Opening Balance", "Previous opening balance cannot be negative.", "Ok");
      return;
    }

    const endpoint = isEdit ? `suppliers/${id}` : "suppliers";
    const method = isEdit ? "PUT" : "POST";

    apiAjax(endpoint, { type: method, data: JSON.stringify(payload) })
      .done(function (result) {
        const returnToPurchase = (supplierReturnToPurchase || $("#modal_supplier").data("return-to-purchase") === true) && !isEdit;
        supplierReturnToPurchase = false;
        if (returnToPurchase && result && result.id) {
          const created = { id: Number(result.id), name: payload.name, phone: payload.phone, status: "active" };
          cachedSuppliers.push(created);
          selectPurchaseSupplier(created);
          setTimeout(function () { $("body").addClass("modal-open"); }, 350);
        }
        $("#modal_supplier").modal("hide");
        notiflix.Notify.success(isEdit ? "Supplier updated successfully." : "Supplier created successfully.");
        loadSuppliers();
      })
      .fail(function (xhr) {
        notiflix.Report.failure("Save Failed", xhr.responseJSON?.message || xhr.responseJSON?.error || "Please try again.", "Ok");
      });
  });

  // Supplier Statement Modal
  $(document).on("click", ".btn-view-statement", function () {
    const id = $(this).data("id");
    loadSupplierStatement(id);
  });

  function loadSupplierStatement(id, start = "", end = "") {
    let url = `suppliers/${id}/statement`;
    if (start && end) url += `?start=${start}&end=${end}`;

    apiAjax(url, { type: "GET" })
      .done(function (data) {
        $("#stmt_supplier_name").text(data.supplier.name);
        $("#stmt_supplier_phone").text(data.supplier.phone || "-");
        $("#stmt_supplier_balance").text(formatMoney(data.current_payable));
        $("#stmt_filter_id").val(id);

        const $tbody = $("#stmt_table_body");
        $tbody.empty();

        if (!data.transactions || data.transactions.length === 0) {
          $tbody.html('<tr><td colspan="6" class="text-center text-muted p-3">No financial transactions recorded for this supplier.</td></tr>');
        } else {
          data.transactions.forEach(function (tx) {
            const dateStr = new Date(tx.date).toLocaleDateString("en-PK");
            const tr = `
              <tr>
                <td>${dateStr}</td>
                <td><strong>${tx.reference_number}</strong></td>
                <td>${tx.description}</td>
                <td class="text-right text-success">${tx.debit ? formatMoney(tx.debit) : "-"}</td>
                <td class="text-right text-danger">${tx.credit ? formatMoney(tx.credit) : "-"}</td>
                <td class="text-right"><strong>${formatMoney(tx.balance)}</strong></td>
              </tr>
            `;
            $tbody.append(tr);
          });
        }

        $("#modal_supplier_statement").modal("show");
      })
      .fail(function (xhr) {
        notiflix.Report.failure("Error", xhr.responseJSON?.error || "Failed to load statement.", "Ok");
      });
  }

  // Filter Statement
  $(document).on("click", "#btn_filter_statement", function () {
    const id = $("#stmt_filter_id").val();
    const start = $("#stmt_start_date").val();
    const end = $("#stmt_end_date").val();
    loadSupplierStatement(id, start, end);
  });

  // Supplier Payment Modal
  $(document).on("click", ".btn-pay-supplier", function () {
    const id = $(this).data("id");
    const supplier = cachedSuppliers.find(s => s.id === id);
    if (!supplier) return;

    $("#pay_supplier_id").val(supplier.id);
    $("#pay_supplier_name").text(supplier.name);
    $("#pay_supplier_balance").text(formatMoney(supplier.outstanding_payable));
    $("#pay_amount_input").val("");
    $("#pay_ref_input").val("");
    $("#pay_notes_input").val("");

    // Load unpaid purchase invoices for this supplier
    apiAjax(`suppliers/${id}/invoices/unpaid`, { type: "GET" })
      .done(function (invoices) {
        const $tbody = $("#pay_invoices_tbody");
        $tbody.empty();

        if (!invoices || invoices.length === 0) {
          $tbody.html('<tr><td colspan="5" class="text-center text-muted">No unpaid invoices pending. Payment will be recorded as advance.</td></tr>');
        } else {
          invoices.forEach(function (inv) {
            const tr = `
              <tr>
                <td><strong>${inv.invoice_no}</strong></td>
                <td>${inv.invoice_date}</td>
                <td>${formatMoney(inv.total)}</td>
                <td class="text-danger font-weight-bold">${formatMoney(inv.outstanding)}</td>
                <td>
                  <input type="number" step="0.01" min="0" max="${inv.outstanding}" class="form-control input-sm pay-alloc-input" data-invoice-id="${inv.id}" placeholder="0.00" />
                </td>
              </tr>
            `;
            $tbody.append(tr);
          });
        }

        $("#modal_supplier_payment").modal("show");
      });
  });

  // Submit Supplier Payment
  $("#form_supplier_payment").on("submit", function (e) {
    e.preventDefault();
    const supplierId = $("#pay_supplier_id").val();
    const amount = Number($("#pay_amount_input").val());
    if (!amount || amount <= 0) {
      notiflix.Report.warning("Invalid Amount", "Please enter a valid payment amount.", "Ok");
      return;
    }

    const allocations = [];
    $(".pay-alloc-input").each(function () {
      const allocAmt = Number($(this).val());
      if (allocAmt > 0) {
        allocations.push({
          invoice_id: $(this).data("invoice-id"),
          amount: allocAmt
        });
      }
    });

    const payload = {
      party_type: "supplier",
      party_id: supplierId,
      amount: amount,
      payment_method: $("#pay_method_select").val(),
      reference_number: $("#pay_ref_input").val().trim(),
      notes: $("#pay_notes_input").val().trim(),
      allocations
    };

    apiAjax("ledger/payments", { type: "POST", data: JSON.stringify(payload) })
      .done(function () {
        $("#modal_supplier_payment").modal("hide");
        notiflix.Notify.success("Payment recorded successfully.");
        loadSuppliers();
        loadDashboard();
      })
      .fail(function (xhr) {
        notiflix.Report.failure("Payment Failed", xhr.responseJSON?.message || xhr.responseJSON?.error || "Error recording payment.", "Ok");
      });
  });

  // ==========================================
  // 3. PURCHASES MANAGEMENT
  // ==========================================

  let cachedPurchases = [];

  function loadPurchases() {
    apiAjax("purchases/all", { type: "GET" })
      .done(function (purchases) {
        cachedPurchases = purchases;
        renderPurchasesTable(purchases);
      })
      .fail(function (xhr) {
        notiflix.Report.failure("Error", xhr.responseJSON?.error || "Failed to load purchases.", "Ok");
      });
  }

  function renderPurchasesTable(purchases) {
    const $tbody = $("#purchases_table_body");
    $tbody.empty();

    if (!purchases || purchases.length === 0) {
      $tbody.html('<tr><td colspan="8" class="text-center text-muted p-4">No purchases found. Click "New Purchase" to record one.</td></tr>');
      return;
    }

    purchases.forEach(function (p) {
      const statusClass = `badge-${p.purchase_status}`;
      const payStatusClass = `badge-${p.payment_status}`;

      const tr = `
        <tr>
          <td><strong>${p.invoice_no}</strong></td>
          <td><strong>${p.supplier_name}</strong></td>
          <td>${p.invoice_date}</td>
          <td><span class="badge-status ${statusClass}">${p.purchase_status}</span></td>
          <td><span class="badge-status ${payStatusClass}">${p.payment_status}</span></td>
          <td><strong>${formatMoney(p.total)}</strong></td>
          <td class="text-danger">${formatMoney(p.outstanding)}</td>
          <td>
            <div class="btn-group btn-group-xs">
              <button class="btn btn-default btn-xs btn-view-purchase" data-id="${p.id}" title="View"><i class="fa fa-eye"></i></button>
              ${p.purchase_status === 'draft' ? `<button class="btn btn-success btn-xs btn-receive-purchase" data-id="${p.id}" title="Receive Stock"><i class="fa fa-check"></i> Receive</button>` : ''}
              ${p.purchase_status === 'received' ? `<button class="btn btn-warning btn-xs btn-return-purchase" data-id="${p.id}" title="Return Items"><i class="fa fa-reply"></i> Return</button>` : ''}
            </div>
          </td>
        </tr>
      `;
      $tbody.append(tr);
    });
  }

  // Open New Purchase Modal
  $(document).on("click", "#btn_new_purchase", async function () {
    $("#form_new_purchase")[0].reset();
    $("#purchase_items_cards").empty();
    $("#purchase_items_empty").show();
    $("#pur_supplier_select").val("");
    $("#pur_supplier_search, #pur_medicine_search, #pur_invoice_no").val("");
    $("#pur_payment_mode").val("fully_paid");
    $("#pur_receiving_mode").val("received");
    $("#pur_paid_now_group").hide();
    $("#pur_paid_now").val("");
    $("#purchase_additional_details").collapse("hide");
    $("#pur_date_input").val(karachiDate());
    $("#modal_new_purchase").modal("show");
    $("#pur_supplier_search, #pur_medicine_search").prop("disabled", true);

    try {
      const results = await Promise.all([
        apiAjax("suppliers/all", { type: "GET" }),
        loadProductsForPurchase(true)
      ]);
      cachedSuppliers = results[0] || [];
      $("#pur_supplier_search, #pur_medicine_search").prop("disabled", false);
      renderPurchaseSupplierResults("");
      renderPurchaseMedicineResults("");
      updatePurchaseSummary();
      setTimeout(function () { $("#pur_supplier_search").focus(); }, 250);
    } catch (xhr) {
      $("#pur_supplier_search, #pur_medicine_search").prop("disabled", false);
      notiflix.Report.failure("Purchase Form", xhr.responseJSON?.error || "Suppliers or medicines could not be loaded.", "Ok");
    }
  });

  let cachedProductsList = [];
  let purchaseSubmitting = false;

  function loadProductsForPurchase(force = false) {
    if (!force && cachedProductsList.length > 0) return Promise.resolve(cachedProductsList);
    return apiAjax("inventory/products", { type: "GET" }).then(function (products) {
      cachedProductsList = products || [];
      return cachedProductsList;
    });
  }

  function moneyCents(value) {
    const text = String(value == null ? "" : value).trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
    const [whole, decimal = ""] = text.split(".");
    const result = Number(whole) * 100 + Number((decimal + "00").slice(0, 2));
    return Number.isSafeInteger(result) ? result : null;
  }

  function centsText(value) {
    return (Number(value || 0) / 100).toFixed(2);
  }

  function renderPurchaseSupplierResults(query) {
    const q = String(query || "").trim().toLowerCase();
    const matches = cachedSuppliers.filter(function (supplier) {
      return supplier.status !== "inactive" && (!q || supplier.name.toLowerCase().includes(q) || String(supplier.phone || "").includes(q));
    }).slice(0, 10);
    const $results = $("#pur_supplier_results").empty();
    if (matches.length === 0) {
      $results.html('<div class="purchase-search-no-results">No matching supplier. Use “Add Supplier”.</div>').show();
      return;
    }
    matches.forEach(function (supplier) {
      $("<button>", { type: "button", class: "purchase-search-option", "data-id": supplier.id })
        .append($("<strong>").text(supplier.name), $("<small>").text(supplier.phone || "No phone number"))
        .appendTo($results);
    });
    $results.show();
  }

  function selectPurchaseSupplier(supplier) {
    if (!supplier) return;
    $("#pur_supplier_select").val(String(supplier.id));
    $("#pur_supplier_search").val(supplier.name).removeClass("has-error");
    $("#pur_supplier_results").hide();
  }

  $(document).on("focus input", "#pur_supplier_search", function () {
    $("#pur_supplier_select").val("");
    renderPurchaseSupplierResults($(this).val());
  });

  $(document).on("click", "#pur_supplier_results .purchase-search-option", function () {
    selectPurchaseSupplier(cachedSuppliers.find(s => String(s.id) === String($(this).data("id"))));
  });

  $(document).on("click", "#btn_purchase_add_supplier", function () {
    supplierReturnToPurchase = true;
    $("#modal_supplier").data("return-to-purchase", true);
    $("#btn_add_supplier").trigger("click");
  });

  $("#modal_supplier").on("hidden.bs.modal", function () {
    supplierReturnToPurchase = false;
    $(this).removeData("return-to-purchase");
    if ($("#modal_new_purchase").hasClass("in")) $("body").addClass("modal-open");
  });

  function productSearchText(product) {
    return [product.name, product.barcode, product.category, product.supplier].filter(Boolean).join(" ").toLowerCase();
  }

  function renderPurchaseMedicineResults(query) {
    const q = String(query || "").trim().toLowerCase();
    const matches = cachedProductsList.filter(p => !q || productSearchText(p).includes(q)).slice(0, 12);
    const $results = $("#pur_medicine_results").empty();
    if (matches.length === 0) {
      $results.html('<div class="purchase-search-no-results">No matching medicine.<br><button type="button" class="btn btn-link btn-xs" id="btn_medicine_no_result_add"><i class="fa fa-plus"></i> Add New Medicine</button></div>').show();
      return;
    }
    matches.forEach(function (product) {
      const detail = [`SKU ${product.barcode}`];
      if (product.category) detail.push(product.category);
      $("<button>", { type: "button", class: "purchase-search-option", "data-id": product._id })
        .append($("<strong>").text(product.name), $("<small>").text(detail.join(" · ")))
        .appendTo($results);
    });
    $results.show();
  }

  $(document).on("focus input", "#pur_medicine_search", function () {
    renderPurchaseMedicineResults($(this).val());
  });

  $(document).on("keydown", "#pur_supplier_search, #pur_medicine_search", function (event) {
    const $results = $(this).is("#pur_supplier_search") ? $("#pur_supplier_results") : $("#pur_medicine_results");
    if (event.key === "Escape") $results.hide();
    if (event.key === "Enter" && $results.is(":visible")) {
      const $first = $results.find(".purchase-search-option").first();
      if ($first.length) {
        event.preventDefault();
        $first.trigger("click");
      }
    }
  });

  $(document).on("click", "#pur_medicine_results .purchase-search-option", function () {
    const product = cachedProductsList.find(p => String(p._id) === String($(this).data("id")));
    if (product) addPurchaseItemCard(product);
  });

  $(document).on("click", function (event) {
    if (!$(event.target).closest(".purchase-search-control").length) $(".purchase-search-results").hide();
  });

  function updatePurchaseCardPreview($card) {
    const prodId = $card.data("product-id");
    const prod = (cachedProductsList || []).find(p => String(p._id) === String(prodId));
    const baseName = (prod && prod.base_unit) ? prod.base_unit : "unit";
    const hasPack = prod && ((prod.units_per_box && prod.units_per_box > 1) || (prod.units_per_strip && prod.units_per_strip > 1));
    if (!hasPack) {
      $card.find(".pur-item-live-preview").hide().empty();
      return;
    }

    const qty = Number($card.find(".pur-item-qty").val()) || 0;
    const bonus = Number($card.find(".pur-item-bonus").val()) || 0;
    const uPerPack = Math.max(1, Number($card.find(".pur-item-units-per-pack").val()) || 1);
    const costCents = moneyCents($card.find(".pur-item-cost").val()) || 0;
    const discInput = $card.find(".pur-item-discount").val().trim();
    const discPct = discInput === "" ? 0 : parseFloat(discInput);
    const validPct = (isNaN(discPct) || discPct < 0) ? 0 : Math.min(100, discPct);

    const grossCents = qty * costCents;
    const discCents = Math.round(grossCents * (validPct / 100));
    const netLineTotalCents = Math.max(0, grossCents - discCents);

    const totalPacks = qty + bonus;
    const totalBaseUnits = totalPacks * uPerPack;

    if (totalBaseUnits > 0) {
      const netUnitCost = (netLineTotalCents / 100) / totalBaseUnits;
      const basePlural = totalBaseUnits === 1 ? baseName : (baseName.endsWith('s') ? baseName : (baseName.toLowerCase() === 'box' ? 'Boxes' : baseName + 's'));
      let previewText = "";
      if (bonus > 0) {
        previewText = `= ${totalBaseUnits} ${basePlural} (incl. ${bonus * uPerPack} bonus), diluted cost PKR ${netUnitCost.toFixed(2)} per ${baseName}`;
      } else {
        previewText = `= ${totalBaseUnits} ${basePlural}, cost PKR ${netUnitCost.toFixed(2)} per ${baseName}`;
      }
      $card.find(".pur-item-live-preview").show().text(previewText);
    } else {
      $card.find(".pur-item-live-preview").hide().empty();
    }
  }

  function addPurchaseItemCard(product, initialCostCents = null, initialValues = null) {
    const cardId = `purchase_item_${Date.now()}_${Math.random().toString().slice(2, 6)}`;
    const costValue = initialCostCents == null ? (initialValues && initialValues.cost != null ? initialValues.cost : "") : centsText(initialCostCents);
    const qtyValue = initialValues && initialValues.quantity != null ? initialValues.quantity : "1";
    const discValue = initialValues && initialValues.discount_percent != null && Number(initialValues.discount_percent) > 0 ? initialValues.discount_percent : "";
    const batchValue = initialValues && initialValues.batch_number != null ? escapeHtml(initialValues.batch_number) : "";
    const expiryValue = initialValues && initialValues.expiry_date != null ? escapeHtml(initialValues.expiry_date) : "";
    const bonusValue = initialValues && initialValues.bonus_quantity != null ? initialValues.bonus_quantity : "0";

    const hasBox = product.units_per_box != null && Number(product.units_per_box) > 1;
    const hasStrip = product.units_per_strip != null && Number(product.units_per_strip) > 1;
    const hasPack = hasBox || hasStrip;

    let selectedUnit = initialValues && initialValues.purchase_unit ? initialValues.purchase_unit : (hasBox ? "box" : (hasStrip ? "strip" : "base"));
    let defaultUnitsPerPack = initialValues && initialValues.units_per_pack ? initialValues.units_per_pack : (selectedUnit === "box" ? product.units_per_box : (selectedUnit === "strip" ? product.units_per_strip : 1));

    let packControlsHtml = "";
    if (hasPack) {
      let unitOptions = "";
      if (hasBox) unitOptions += `<option value="box" data-u="${product.units_per_box}" ${selectedUnit === 'box' ? 'selected' : ''}>Box (${product.units_per_box} ${product.base_unit || 'units'})</option>`;
      if (hasStrip) unitOptions += `<option value="strip" data-u="${product.units_per_strip}" ${selectedUnit === 'strip' ? 'selected' : ''}>Strip (${product.units_per_strip} ${product.base_unit || 'units'})</option>`;
      unitOptions += `<option value="base" data-u="1" ${selectedUnit === 'base' ? 'selected' : ''}>${product.base_unit || 'Base Unit'}</option>`;

      packControlsHtml = `
        <div class="purchase-pack-row row m-b-5" style="margin-left:0; margin-right:0; padding:6px 0; border-bottom:1px dashed #e2e8f0;">
          <div class="col-xs-6" style="padding-left:0;">
            <label style="font-size:11px; margin-bottom:2px;">Purchase Unit</label>
            <select class="form-control input-sm pur-item-unit">${unitOptions}</select>
          </div>
          <div class="col-xs-6" style="padding-right:0;">
            <label style="font-size:11px; margin-bottom:2px;">Units per Pack</label>
            <input type="number" min="1" step="1" class="form-control input-sm pur-item-units-per-pack" value="${defaultUnitsPerPack}" required />
          </div>
        </div>
      `;
    }

    const qtyNum = Number(qtyValue) || 1;
    const costNum = moneyCents(costValue) || 0;
    const discNum = parseFloat(discValue) || 0;
    const grossCents = qtyNum * costNum;
    const discCents = Math.round(grossCents * (discNum / 100));
    const lineTotalCents = Math.max(0, grossCents - discCents);
    const lineTotalText = centsText(lineTotalCents);

    const card = `
      <div class="purchase-item-card" id="${cardId}" data-product-id="${product._id}">
        <div class="purchase-item-card-header">
          <div><strong>${escapeHtml(product.name)}</strong> <small class="text-muted">SKU ${escapeHtml(product.barcode)}</small></div>
          <button type="button" class="btn btn-link text-danger btn-remove-pur-row" title="Remove medicine"><i class="fa fa-trash"></i></button>
        </div>
        ${packControlsHtml}
        <div class="purchase-item-fields">
          <div><label>Quantity</label><input type="number" min="1" step="1" class="form-control pur-item-qty" value="${qtyValue}" required /></div>
          <div><label>Purchase Price</label><input type="number" min="0" step="0.01" class="form-control pur-item-cost" value="${costValue}" placeholder="0.00" required /></div>
          <div><label>Discount %</label><div class="input-group"><input type="number" min="0" max="100" step="0.01" class="form-control pur-item-discount" value="${discValue}" placeholder="0" /><span class="input-group-addon">%</span></div></div>
          <div><label>Line Total</label><div class="purchase-line-total">PKR <span class="pur-item-linetotal">${lineTotalText}</span></div></div>
          <div><label>Batch Number</label><input type="text" class="form-control pur-item-batch" value="${batchValue}" placeholder="Batch #" required /></div>
          <div><label>Expiry Date</label><input type="date" class="form-control pur-item-expiry" value="${expiryValue}" required /></div>
          <div><label>Bonus Qty</label><input type="number" min="0" step="1" class="form-control pur-item-bonus" value="${bonusValue}" /></div>
        </div>
        <div class="pur-item-live-preview text-info" style="font-size:11px; font-weight:600; margin-top:5px; display:none;"></div>
      </div>`;
    $("#purchase_items_cards").append(card);
    $("#purchase_items_empty").hide();
    $("#pur_medicine_search").val("");
    $("#pur_medicine_results").hide();
    recalculatePurchaseTotal();
    const $newCard = $(`#${cardId}`);
    updatePurchaseCardPreview($newCard);
    $newCard.find(".pur-item-qty").focus();
    return $newCard;
  }

  $(document).on("click", "#btn_add_purchase_row", function () {
    $("#pur_medicine_search").focus();
    renderPurchaseMedicineResults("");
  });

  $(document).on("click", ".btn-remove-pur-row", function () {
    $(this).closest(".purchase-item-card").remove();
    $("#purchase_items_empty").toggle($("#purchase_items_cards .purchase-item-card").length === 0);
    recalculatePurchaseTotal();
  });

  $(document).on("change", ".pur-item-unit", function () {
    const $card = $(this).closest(".purchase-item-card");
    const prodId = $card.data("product-id");
    const prod = (cachedProductsList || []).find(p => String(p._id) === String(prodId));
    const selUnit = $(this).val();
    let u = 1;
    if (selUnit === "box" && prod && prod.units_per_box) u = prod.units_per_box;
    else if (selUnit === "strip" && prod && prod.units_per_strip) u = prod.units_per_strip;
    $card.find(".pur-item-units-per-pack").val(u);
    updatePurchaseCardPreview($card);
  });

  $(document).on("input change", ".pur-item-qty, .pur-item-cost, .pur-item-discount, .pur-item-bonus, .pur-item-units-per-pack", function () {
    const $card = $(this).closest(".purchase-item-card");
    const qty = Number($card.find(".pur-item-qty").val()) || 0;
    const costCents = moneyCents($card.find(".pur-item-cost").val()) || 0;
    const discInput = $card.find(".pur-item-discount").val().trim();
    const discPct = discInput === "" ? 0 : parseFloat(discInput);

    if (isNaN(discPct) || discPct < 0 || discPct > 100) {
      $card.find(".pur-item-discount").css("border-color", "#ef4444");
    } else {
      $card.find(".pur-item-discount").css("border-color", "");
    }

    const validPct = (isNaN(discPct) || discPct < 0) ? 0 : Math.min(100, discPct);
    const grossCents = qty * costCents;
    const discCents = Math.round(grossCents * (validPct / 100));
    const lineTotalCents = Math.max(0, grossCents - discCents);
    $card.find(".pur-item-linetotal").text(centsText(lineTotalCents));
    recalculatePurchaseTotal();
    updatePurchaseCardPreview($card);
  });

  function recalculatePurchaseTotal() {
    let totalCents = 0;
    $("#purchase_items_cards .purchase-item-card").each(function () {
      const qty = Number($(this).find(".pur-item-qty").val()) || 0;
      const costCents = moneyCents($(this).find(".pur-item-cost").val()) || 0;
      const discInput = $(this).find(".pur-item-discount").val().trim();
      const discPct = discInput === "" ? 0 : parseFloat(discInput);
      const validPct = (isNaN(discPct) || discPct < 0) ? 0 : Math.min(100, discPct);

      const grossCents = qty * costCents;
      const discCents = Math.round(grossCents * (validPct / 100));
      const lineTotalCents = Math.max(0, grossCents - discCents);
      totalCents += lineTotalCents;
    });
    $("#pur_grand_total").text(centsText(totalCents));
    updatePurchaseSummary(totalCents);
    return totalCents;
  }

  function updatePurchaseSummary(totalCents = null) {
    if (totalCents == null) totalCents = moneyCents($("#pur_grand_total").text()) || 0;
    const mode = $("#pur_payment_mode").val();
    let paidCents = 0;
    if (mode === "fully_paid") paidCents = totalCents;
    if (mode === "partial") paidCents = moneyCents($("#pur_paid_now").val()) || 0;
    paidCents = Math.min(paidCents, totalCents);
    $("#pur_summary_paid").text(centsText(paidCents));
    $("#pur_summary_remaining").text(centsText(totalCents - paidCents));
    $("#pur_paid_now_group").toggle(mode === "partial");
    $("#pur_pay_method").prop("disabled", mode === "unpaid");
  }

  $(document).on("change input", "#pur_payment_mode, #pur_paid_now", function () { updatePurchaseSummary(); });

  let quickPackForm = null;
  if (typeof window !== "undefined" && window.ProductPackFormHelper) {
    quickPackForm = window.ProductPackFormHelper.bindForm({ prefix: "quick_", isQuickAdd: true });
  }

  $(document).on("click", "#btn_generate_purchase_ref", function () {
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
    $("#pur_invoice_no").val(`MM-PUR-${stamp}`);
  });

  $(document).on("click", "#btn_quick_add_medicine, #btn_medicine_no_result_add", function () {
    const suggestedName = $("#pur_medicine_search").val().trim();
    $("#form_quick_medicine")[0].reset();
    if (quickPackForm) quickPackForm.reset();
    $("#quick_med_name").val(suggestedName);
    $("#modal_quick_medicine").modal("show");
    setTimeout(function () { $(suggestedName ? "#quick_med_selling_price" : "#quick_med_name").focus(); }, 250);
  });

  $("#modal_quick_medicine").on("hidden.bs.modal", function () {
    if ($("#modal_new_purchase").hasClass("in")) $("body").addClass("modal-open");
  });

  $("#form_quick_medicine").on("submit", function (event) {
    event.preventDefault();
    const name = $("#quick_med_name").val().trim();
    const sellingCents = moneyCents($("#quick_med_selling_price").val());
    const sku = $("#quick_med_sku").val().trim();
    if (!name || sellingCents == null || sellingCents <= 0) {
      notiflix.Report.warning("Medicine Details", "Enter a medicine name and valid selling price greater than zero.", "Ok");
      return;
    }
    if (sku && !/^\d+$/.test(sku)) {
      notiflix.Report.warning("Invalid SKU", "SKU must contain numbers only, or leave it blank for an internal SKU.", "Ok");
      return;
    }

    const mode = $("input[name='quick_sold_type']:checked").val() || "single";
    let quickBaseUnit = "";
    let quickUnitsStrip = "";
    let quickUnitsBox = "";
    let quickStripPrice = "";
    let quickBoxPrice = "";
    let quickDefaultSaleUnit = "base";

    if (mode === "single") {
      const uVal = $("#quick_single_unit").val();
      quickBaseUnit = uVal === "custom" ? $("#quick_single_unit_custom").val().trim() : uVal;
    } else {
      const bVal = $("#quick_base_unit").val();
      quickBaseUnit = bVal === "custom" ? $("#quick_base_unit_custom").val().trim() : bVal;
      quickUnitsStrip = $("#quick_units_per_strip").val().trim();
      quickUnitsBox = $("#quick_units_per_box").val().trim();
      quickStripPrice = $("#quick_strip_price").val().trim();
      quickBoxPrice = $("#quick_box_price").val().trim();
      quickDefaultSaleUnit = $("#quick_default_sale_unit").val() || "base";

      const uStrip = parseInt(quickUnitsStrip) || 0;
      const uBox = parseInt(quickUnitsBox) || 0;
      if (uStrip > 0 && uStrip < 2) {
        notiflix.Report.warning("Invalid Pack", "Units per strip must be 2 or greater.", "Ok");
        return;
      }
      if (uBox > 0 && uBox < 2) {
        notiflix.Report.warning("Invalid Pack", "Units per box must be 2 or greater.", "Ok");
        return;
      }
      if (uStrip > 0 && uBox > 0 && (uBox % uStrip !== 0)) {
        notiflix.Report.warning("Invalid Pack", "Units per box must be an exact multiple of units per strip.", "Ok");
        return;
      }
    }

    const form = new FormData();
    const catVal = $("#quick_med_category").val() || "";
    const quickData = {
      id: "", img: "", remove: "", quick_add: "1", name,
      barcode: sku, expirationDate: "", price: centsText(sellingCents),
      category: (catVal === "__add_new__" ? "" : catVal).trim(), supplier: "", quantity: "0", minStock: "0"
    };
    if (quickBaseUnit) quickData.base_unit = quickBaseUnit;
    if (quickUnitsStrip) quickData.units_per_strip = quickUnitsStrip;
    if (quickUnitsBox) quickData.units_per_box = quickUnitsBox;
    if (quickStripPrice) quickData.strip_price = quickStripPrice;
    if (quickBoxPrice) quickData.box_price = quickBoxPrice;
    if (quickDefaultSaleUnit) quickData.default_sale_unit = quickDefaultSaleUnit;

    Object.entries(quickData).forEach(([key, value]) => form.append(key, value));
    const $button = $("#btn_save_quick_medicine").prop("disabled", true).text("Saving...");
    $.ajax({
      url: getApiUrl("inventory/product"), type: "POST", data: form,
      headers: getAuthToken() ? { "X-Access-Token": getAuthToken() } : {},
      contentType: false, processData: false
    }).done(function (result) {
      const product = result && result.product;
      if (!product) throw new Error("Medicine was saved but no product was returned.");
      cachedProductsList.push(product);
      const $card = addPurchaseItemCard(product, null);
      $("#modal_quick_medicine").modal("hide");
      setTimeout(function () {
        if ($card && $card.length) {
          $card.find(".pur-item-qty").focus();
        }
      }, 350);
      notiflix.Notify.success("Medicine saved. Add its batch and expiry below.");
    }).fail(function (xhr) {
      notiflix.Report.failure("Medicine Not Saved", xhr.responseJSON?.message || xhr.responseJSON?.error || "Please try again.", "Ok");
    }).always(function () {
      $button.prop("disabled", false).html('<i class="fa fa-save"></i> Save Medicine');
    });
  });

  // Submit New Purchase
  $("#form_new_purchase").on("submit", function (e) {
    e.preventDefault();
    if (purchaseSubmitting) return;
    const supplierId = $("#pur_supplier_select").val();
    if (!supplierId) {
      notiflix.Report.warning("Supplier Missing", "Please select a supplier.", "Ok");
      return;
    }

    const items = [];
    let hasInvalid = false;

    $("#purchase_items_cards .purchase-item-card").each(function () {
      const prodId = $(this).data("product-id");
      const batch = $(this).find(".pur-item-batch").val().trim();
      const expiry = $(this).find(".pur-item-expiry").val().trim();
      const qty = Number($(this).find(".pur-item-qty").val());
      const bonus = Number($(this).find(".pur-item-bonus").val()) || 0;
      const costCents = moneyCents($(this).find(".pur-item-cost").val());
      const discInput = $(this).find(".pur-item-discount").val().trim();
      const discPct = discInput === "" ? 0 : parseFloat(discInput);

      if (!prodId || !batch || !expiry || !Number.isSafeInteger(qty) || qty <= 0 || !Number.isSafeInteger(bonus) || bonus < 0 || costCents == null || isNaN(discPct) || discPct < 0 || discPct > 100) {
        hasInvalid = true;
        return false;
      }

      const grossCents = qty * costCents;
      const discCents = Math.round(grossCents * (discPct / 100));
      const lineTotalCents = Math.max(0, grossCents - discCents);

      const purUnit = $(this).find(".pur-item-unit").val() || "base";
      const uPerPack = Number($(this).find(".pur-item-units-per-pack").val()) || 1;

      items.push({
        product_id: prodId,
        batch_number: batch,
        expiry_date: expiry,
        quantity: qty,
        purchase_unit: purUnit,
        units_per_pack: uPerPack,
        bonus_quantity: bonus,
        unit_cost: centsText(costCents),
        discount_percent: discPct,
        discount: centsText(discCents),
        line_total: centsText(lineTotalCents),
        line_total_cents: lineTotalCents
      });
    });

    if (hasInvalid || items.length === 0) {
      notiflix.Report.warning("Incomplete Items", "Please fill in all product fields, batch numbers, and expiry dates.", "Ok");
      return;
    }

    const invoiceNumber = $("#pur_invoice_no").val().trim();
    if (!invoiceNumber) {
      notiflix.Report.warning("Invoice Number", "Enter the supplier invoice number or click Generate for an internal reference.", "Ok");
      return;
    }
    const totalCents = recalculatePurchaseTotal();
    const paymentMode = $("#pur_payment_mode").val();
    let paidCents = paymentMode === "fully_paid" ? totalCents : 0;
    if (paymentMode === "partial") paidCents = moneyCents($("#pur_paid_now").val());
    if (paidCents == null || paidCents < 0 || paidCents > totalCents || (paymentMode === "partial" && (paidCents === 0 || paidCents === totalCents))) {
      notiflix.Report.warning("Payment Amount", "For a partial payment, enter an amount greater than zero and less than the purchase total.", "Ok");
      return;
    }

    const payload = {
      supplier_id: supplierId,
      invoice_no: invoiceNumber,
      invoice_date: $("#pur_date_input").val(),
      due_date: $("#pur_due_date_input").val(),
      status: $("#pur_receiving_mode").val(),
      paid_amount: centsText(paidCents),
      payment_method: paymentMode === "unpaid" ? "cash" : $("#pur_pay_method").val(),
      notes: $("#pur_notes").val().trim(),
      items
    };

    purchaseSubmitting = true;
    const $save = $("#btn_save_purchase").prop("disabled", true).html('<i class="fa fa-spinner fa-spin"></i> Saving...');
    apiAjax("purchases", { type: "POST", data: JSON.stringify(payload) })
      .done(function () {
        loadPurchases();
        loadSuppliers();
        loadDashboard();
        $("#modal_new_purchase").modal("hide");
        notiflix.Notify.success(payload.status === "received" ? "Purchase saved and stock received." : "Purchase draft saved. Stock was not changed.");
      })
      .fail(function (xhr) {
        notiflix.Report.failure("Error", xhr.responseJSON?.message || xhr.responseJSON?.error || "Failed to save purchase.", "Ok");
      })
      .always(function () {
        purchaseSubmitting = false;
        $save.prop("disabled", false).html('<i class="fa fa-save"></i> Save Purchase');
      });
  });

  // View Purchase Details
  $(document).on("click", ".btn-view-purchase", function () {
    const id = $(this).data("id");
    apiAjax(`purchases/${id}`, { type: "GET" })
      .done(function (p) {
        $("#vpur_invoice_no").text(p.invoice_no);
        $("#vpur_supplier").text(p.supplier_name);
        $("#vpur_date").text(p.invoice_date);
        $("#vpur_status").text(p.purchase_status);
        $("#vpur_payment_status").text(p.payment_status);
        $("#vpur_total").text(formatMoney(p.total));
        $("#vpur_paid").text(formatMoney(p.paid));
        $("#vpur_outstanding").text(formatMoney(p.outstanding));

        const $tbody = $("#vpur_items_tbody");
        $tbody.empty();
        (p.items || []).forEach(function (it) {
          const discText = (it.discount_percent && Number(it.discount_percent) > 0) ? `${it.discount_percent}%` : '-';
          $tbody.append(`
            <tr>
              <td><strong>${it.product_name}</strong></td>
              <td>${it.batch_number}</td>
              <td>${it.expiry_date}</td>
              <td>${it.pack_display ? escapeHtml(it.pack_display) : it.quantity} ${it.bonus_quantity > 0 ? `(+${it.bonus_quantity} bonus)` : ''}</td>
              <td>${formatMoney(it.unit_cost)}</td>
              <td>${discText}</td>
              <td><strong>${formatMoney(it.line_total)}</strong></td>
            </tr>
          `);
        });

        $("#modal_view_purchase").modal("show");
      });
  });

  // Receive Draft Purchase
  $(document).on("click", ".btn-receive-purchase", function () {
    const id = $(this).data("id");
    notiflix.Confirm.show(
      "Receive Purchase",
      "Are you sure you want to receive this purchase into stock and post it to accounts?",
      "Yes, Receive",
      "Cancel",
      function () {
        apiAjax(`purchases/${id}/receive`, { type: "POST", data: JSON.stringify({}) })
          .done(function () {
            notiflix.Notify.success("Purchase received into stock successfully.");
            loadPurchases();
            loadSuppliers();
            loadDashboard();
          })
          .fail(function (xhr) {
            notiflix.Report.failure("Receive Failed", xhr.responseJSON?.message || xhr.responseJSON?.error || "Error receiving purchase.", "Ok");
          });
      }
    );
  });

  function updateReturnMaxPreview() {
    const $selected = $("#pret_item_select option:selected");
    const idx = $selected.data("index");
    const items = $("#modal_purchase_return").data("items") || [];
    const item = items[idx];
    if (!item) return;
    const prod = (cachedProductsList || []).find(p => String(p._id) === String(item.product_id));
    const selUnit = $("#pret_unit_select").val() || "base";
    let mult = 1;
    if (selUnit === "box" && prod && prod.units_per_box) mult = prod.units_per_box;
    else if (selUnit === "strip" && prod && prod.units_per_strip) mult = prod.units_per_strip;

    const maxBase = item.base_quantity || (item.quantity * (item.units_per_pack || 1));
    const maxInUnit = Math.floor(maxBase / mult);
    $("#pret_max_preview").show().text(`Max returnable: ${maxInUnit} ${selUnit} (${maxBase} base units)`);
    $("#pret_qty_input").attr("max", maxInUnit);
  }

  // Purchase Return Modal
  $(document).on("click", ".btn-return-purchase", function () {
    const id = $(this).data("id");
    apiAjax(`purchases/${id}`, { type: "GET" })
      .done(function (p) {
        $("#pret_purchase_id").val(p.id);
        $("#pret_invoice_no").text(p.invoice_no);
        $("#pret_supplier").text(p.supplier_name);

        const returnPurchaseItems = p.items || [];
        $("#modal_purchase_return").data("items", returnPurchaseItems);
        const $select = $("#pret_item_select");
        $select.empty().append('<option value="">Select Item to Return...</option>');
        returnPurchaseItems.forEach(function (it, idx) {
          $select.append(`<option value="${it.product_id}" data-index="${idx}" data-batch="${it.batch_number}" data-qty="${it.quantity}">
            ${it.product_name} (Batch: ${it.batch_number}, Purchased: ${it.pack_display || it.quantity})
          </option>`);
        });
        $("#pret_unit_wrap").hide();
        $("#pret_max_preview").hide().empty();

        $("#modal_purchase_return").modal("show");
      });
  });

  $(document).on("change", "#pret_item_select", function () {
    const $selected = $(this).find("option:selected");
    const idx = $selected.data("index");
    const items = $("#modal_purchase_return").data("items") || [];
    const item = items[idx];
    if (!item) {
      $("#pret_unit_wrap").hide();
      $("#pret_max_preview").hide().empty();
      return;
    }
    const prod = (cachedProductsList || []).find(p => String(p._id) === String(item.product_id));
    const hasBox = prod && prod.units_per_box > 1;
    const hasStrip = prod && prod.units_per_strip > 1;
    if (hasBox || hasStrip) {
      let unitOpts = "";
      if (hasBox) unitOpts += `<option value="box" data-u="${prod.units_per_box}">Box</option>`;
      if (hasStrip) unitOpts += `<option value="strip" data-u="${prod.units_per_strip}">Strip</option>`;
      unitOpts += `<option value="base" data-u="1">${prod.base_unit || 'Base'}</option>`;
      $("#pret_unit_select").html(unitOpts);
      $("#pret_unit_wrap").show();
      updateReturnMaxPreview();
    } else {
      $("#pret_unit_wrap").hide();
      $("#pret_max_preview").show().text(`Max returnable: ${item.quantity} units`);
    }
  });

  $(document).on("change", "#pret_unit_select", updateReturnMaxPreview);

  $("#form_purchase_return").on("submit", function (e) {
    e.preventDefault();
    const purchaseId = $("#pret_purchase_id").val();
    const $selected = $("#pret_item_select option:selected");
    const productId = $selected.val();
    const batchNumber = $selected.data("batch");
    const qty = Number($("#pret_qty_input").val());
    const reason = $("#pret_reason_input").val().trim();
    const returnUnit = $("#pret_unit_wrap").is(":visible") ? $("#pret_unit_select").val() : "base";

    if (!productId || qty <= 0) {
      notiflix.Report.warning("Invalid Return", "Please select an item and enter a valid quantity.", "Ok");
      return;
    }

    apiAjax(`purchases/${purchaseId}/return`, {
      type: "POST",
      data: JSON.stringify({ product_id: productId, batch_number: batchNumber, quantity: qty, return_unit: returnUnit, reason })
    })
      .done(function () {
        $("#modal_purchase_return").modal("hide");
        notiflix.Notify.success("Purchase return recorded and stock deducted.");
        loadPurchases();
        loadSuppliers();
        loadDashboard();
      })
      .fail(function (xhr) {
        notiflix.Report.failure("Return Failed", xhr.responseJSON?.message || xhr.responseJSON?.error || "Error processing return.", "Ok");
      });
  });

  // ==========================================
  // 4. CUSTOMER KHATA (UDHAAR)
  // ==========================================

  let cachedCustomers = [];

  function loadCustomersKhata() {
    apiAjax("customers/all", { type: "GET" })
      .done(function (customers) {
        cachedCustomers = customers;
        renderCustomersKhataTable(customers);
      });
  }

  function renderCustomersKhataTable(customers) {
    const $tbody = $("#khata_table_body");
    $tbody.empty();

    if (!customers || customers.length === 0) {
      $tbody.html('<tr><td colspan="6" class="text-center text-muted p-4">No customers found.</td></tr>');
      return;
    }

    customers.forEach(function (c) {
      // Fetch customer balance
      apiAjax(`ledger/customers/${c._id}/statement`, { type: "GET" })
        .done(function (stmt) {
          const recCents = Number(stmt.current_receivable_cents || 0);
          const recClass = recCents > 0 ? "money-positive" : "money-neutral";

          const tr = `
            <tr id="khata_row_${c._id}">
              <td><strong>${c._id}</strong></td>
              <td><strong>${c.name}</strong></td>
              <td>${c.phone || "-"}</td>
              <td>${formatMoney(stmt.customer.credit_limit)}</td>
              <td class="${recClass}"><strong>${formatMoney(stmt.current_receivable)}</strong></td>
              <td>
                <div class="btn-group btn-group-xs">
                  <button class="btn btn-default btn-xs btn-cust-statement" data-id="${c._id}"><i class="fa fa-file-text-o"></i> Statement</button>
                  <button class="btn btn-success btn-xs btn-cust-pay" data-id="${c._id}"><i class="fa fa-money"></i> Collect</button>
                </div>
              </td>
            </tr>
          `;
          $tbody.append(tr);
        });
    });
  }

  // Customer Statement Modal
  $(document).on("click", ".btn-cust-statement", function () {
    const id = $(this).data("id");
    loadCustomerStatement(id);
  });

  function loadCustomerStatement(id, start = "", end = "") {
    let url = `ledger/customers/${id}/statement`;
    if (start && end) url += `?start=${start}&end=${end}`;

    apiAjax(url, { type: "GET" })
      .done(function (data) {
        $("#cstmt_name").text(data.customer.name);
        $("#cstmt_phone").text(data.customer.phone || "-");
        $("#cstmt_balance").text(formatMoney(data.current_receivable));
        $("#cstmt_filter_id").val(id);

        const $tbody = $("#cstmt_table_body");
        $tbody.empty();

        if (!data.transactions || data.transactions.length === 0) {
          $tbody.html('<tr><td colspan="6" class="text-center text-muted p-3">No khata transactions for this customer.</td></tr>');
        } else {
          data.transactions.forEach(function (tx) {
            const dateStr = new Date(tx.date).toLocaleDateString("en-PK");
            const tr = `
              <tr>
                <td>${dateStr}</td>
                <td><strong>${tx.reference_number}</strong></td>
                <td>${tx.description}</td>
                <td class="text-right text-danger">${tx.debit ? formatMoney(tx.debit) : "-"}</td>
                <td class="text-right text-success">${tx.credit ? formatMoney(tx.credit) : "-"}</td>
                <td class="text-right"><strong>${formatMoney(tx.balance)}</strong></td>
              </tr>
            `;
            $tbody.append(tr);
          });
        }

        $("#modal_customer_statement").modal("show");
      });
  }

  // Customer Payment (Khata Collection) Modal
  $(document).on("click", ".btn-cust-pay", function () {
    const id = $(this).data("id");
    apiAjax(`ledger/customers/${id}/statement`, { type: "GET" })
      .done(function (data) {
        $("#cpay_cust_id").val(id);
        $("#cpay_cust_name").text(data.customer.name);
        $("#cpay_cust_balance").text(formatMoney(data.current_receivable));
        $("#cpay_amount_input").val("");
        $("#cpay_ref_input").val("");
        $("#cpay_notes_input").val("");

        $("#modal_customer_payment").modal("show");
      });
  });

  $("#form_customer_payment").on("submit", function (e) {
    e.preventDefault();
    const custId = $("#cpay_cust_id").val();
    const amount = Number($("#cpay_amount_input").val());
    if (!amount || amount <= 0) {
      notiflix.Report.warning("Invalid Amount", "Please enter valid payment amount.", "Ok");
      return;
    }

    const payload = {
      party_type: "customer",
      party_id: custId,
      amount: amount,
      payment_method: $("#cpay_method_select").val(),
      reference_number: $("#cpay_ref_input").val().trim(),
      notes: $("#cpay_notes_input").val().trim()
    };

    apiAjax("ledger/payments", { type: "POST", data: JSON.stringify(payload) })
      .done(function () {
        $("#modal_customer_payment").modal("hide");
        notiflix.Notify.success("Khata payment received and added to cashbook.");
        loadCustomersKhata();
        loadDashboard();
      })
      .fail(function (xhr) {
        notiflix.Report.failure("Error", xhr.responseJSON?.message || xhr.responseJSON?.error || "Error recording payment.", "Ok");
      });
  });

  // ==========================================
  // 5. EXPENSE MANAGEMENT
  // ==========================================

  let cachedExpenseCategories = [];

  function loadExpenses() {
    apiAjax("expenses/categories", { type: "GET" }).done(function (cats) {
      cachedExpenseCategories = cats;
      const $select = $("#exp_category_select");
      $select.empty().append('<option value="">Select Category...</option>');
      cats.forEach(function (c) {
        $select.append(`<option value="${c.id}">${c.name}</option>`);
      });
    });

    apiAjax("expenses/all", { type: "GET" })
      .done(function (expenses) {
        const $tbody = $("#expenses_table_body");
        $tbody.empty();

        if (!expenses || expenses.length === 0) {
          $tbody.html('<tr><td colspan="7" class="text-center text-muted p-4">No expenses recorded yet.</td></tr>');
          return;
        }

        expenses.forEach(function (e) {
          const dateStr = new Date(e.expense_date).toLocaleDateString("en-PK");
          const tr = `
            <tr>
              <td><strong>${e.expense_number}</strong></td>
              <td>${dateStr}</td>
              <td><span class="badge-status badge-partially_paid">${e.category_name}</span></td>
              <td>${e.description}</td>
              <td>${e.payment_method}</td>
              <td><strong class="text-danger">${formatMoney(e.amount)}</strong></td>
              <td><small class="text-muted">${e.recorded_by}</small></td>
            </tr>
          `;
          $tbody.append(tr);
        });
      });
  }

  // Open Add Expense Modal
  $(document).on("click", "#btn_add_expense", function () {
    $("#form_add_expense")[0].reset();
    $("#exp_date_input").val(new Date().toISOString().slice(0, 10));
    $("#modal_add_expense").modal("show");
  });

  $("#form_add_expense").on("submit", function (e) {
    e.preventDefault();
    const payload = {
      category_id: $("#exp_category_select").val(),
      amount: $("#exp_amount_input").val(),
      payment_method: $("#exp_method_select").val(),
      expense_date: $("#exp_date_input").val(),
      description: $("#exp_desc_input").val().trim(),
      reference_number: $("#exp_ref_input").val().trim()
    };

    apiAjax("expenses", { type: "POST", data: JSON.stringify(payload) })
      .done(function () {
        $("#modal_add_expense").modal("hide");
        notiflix.Notify.success("Expense recorded successfully.");
        loadExpenses();
        loadDashboard();
      })
      .fail(function (xhr) {
        notiflix.Report.failure("Error", xhr.responseJSON?.message || xhr.responseJSON?.error || "Error recording expense.", "Ok");
      });
  });

  // ==========================================
  // 6. REPORT CENTER (11 REPORTS)
  // ==========================================

  let currentReportKey = "pnl";
  let currentRangePreset = "this_month";

  function getTodayKarachi() {
    return moment().utcOffset("+05:00").format("YYYY-MM-DD");
  }

  function resolveReportDateRange(preset) {
    const today = moment().utcOffset("+05:00");
    let from = today.clone().startOf("month").format("YYYY-MM-DD");
    let to = today.clone().endOf("month").format("YYYY-MM-DD");

    if (preset === "today") {
      from = today.format("YYYY-MM-DD");
      to = today.format("YYYY-MM-DD");
    } else if (preset === "this_week") {
      from = today.clone().startOf("isoWeek").format("YYYY-MM-DD");
      to = today.clone().endOf("isoWeek").format("YYYY-MM-DD");
    } else if (preset === "this_month") {
      from = today.clone().startOf("month").format("YYYY-MM-DD");
      to = today.clone().endOf("month").format("YYYY-MM-DD");
    } else if (preset === "last_month") {
      from = today.clone().subtract(1, "month").startOf("month").format("YYYY-MM-DD");
      to = today.clone().subtract(1, "month").endOf("month").format("YYYY-MM-DD");
    } else if (preset === "custom") {
      const rawFrom = $("#reports_view #rep_date_from").val() ? $("#reports_view #rep_date_from").val().trim() : "";
      const rawTo = $("#reports_view #rep_date_to").val() ? $("#reports_view #rep_date_to").val().trim() : "";
      from = rawFrom || from;
      to = rawTo || to;
    }
    return { from, to };
  }

  function setReportRangeInputs(preset) {
    currentRangePreset = preset;
    $("#reports_view #rep_date_presets button").removeClass("active");
    $("#reports_view #rep_date_presets button[data-range=\"" + preset + "\"]").addClass("active");
    if (preset !== "custom") {
      const dates = resolveReportDateRange(preset);
      $("#reports_view #rep_date_from").val(dates.from);
      $("#reports_view #rep_date_to").val(dates.to);
    }
  }

  function setupExtraReportFilters(key) {
    const $extra = $("#reports_view #rep_extra_filters");
    $extra.empty();
    $("#reports_view #rep_date_presets").show();
    $("#reports_view #rep_custom_date_inputs").show();
    $("#reports_view #rep_date_from_label").hide();
    $("#reports_view #rep_date_sep").show();
    $("#reports_view #rep_date_to").show();

    if (key === "expiry") {
      $extra.html(`
        <label class="m-r-5" style="font-size:12px;">Bucket:</label>
        <select id="rep_filter_expiry_bucket" class="form-control input-sm" style="width:140px;">
          <option value="all">All Batches</option>
          <option value="expired">Expired Only</option>
          <option value="30">&le; 30 Days</option>
          <option value="60">&le; 60 Days</option>
          <option value="90">&le; 90 Days</option>
        </select>
      `);
      $("#reports_view #rep_date_presets, #reports_view #rep_custom_date_inputs").hide();
    } else if (key === "low_stock") {
      $("#reports_view #rep_date_presets, #reports_view #rep_custom_date_inputs").hide();
    } else if (key === "stock_valuation") {
      $("#reports_view #rep_date_presets, #reports_view #rep_custom_date_inputs").hide();
    } else if (key === "product_movement") {
      $extra.html(`
        <label class="m-r-5" style="font-size:12px;">Inactivity:</label>
        <select id="rep_filter_movement_days" class="form-control input-sm" style="width:130px;">
          <option value="30">30 Days</option>
          <option value="60">60 Days</option>
          <option value="90" selected>90 Days (Default)</option>
          <option value="180">180 Days</option>
        </select>
      `);
      $("#reports_view #rep_date_presets, #reports_view #rep_custom_date_inputs").hide();
    } else if (key === "sales") {
      $extra.html(`
        <label class="m-r-5" style="font-size:12px;">View by:</label>
        <select id="rep_filter_sales_group" class="form-control input-sm" style="width:110px;">
          <option value="day" selected>Daily</option>
          <option value="month">Monthly</option>
        </select>
      `);
    } else if (key === "daily_closing") {
      $("#reports_view #rep_date_presets").hide();
      $("#reports_view #rep_date_from_label").text("Closing Date:").show();
      $("#reports_view #rep_date_sep").hide();
      $("#reports_view #rep_date_to").hide();
      $("#reports_view #rep_date_from").val(getTodayKarachi());
    } else if (key === "payables_aging" || key === "inventory") {
      $("#reports_view #rep_date_presets, #reports_view #rep_custom_date_inputs").hide();
    }
  }

  function loadReports() {
    $("#reports_view #reports_menu a").removeClass("active");
    $("#reports_view #reports_menu a[data-report=\"" + currentReportKey + "\"]").addClass("active");
    setReportRangeInputs("this_month");
    setupExtraReportFilters(currentReportKey);
    loadActiveReport();
  }

  function loadActiveReport() {
    let fromVal = $("#reports_view #rep_date_from").val() ? $("#reports_view #rep_date_from").val().trim() : "";
    let toVal = $("#reports_view #rep_date_to").val() ? $("#reports_view #rep_date_to").val().trim() : "";

    // Normalize any non-padded dates
    if (fromVal && /^\d{4}-\d{1,2}-\d{1,2}$/.test(fromVal)) {
      const p = fromVal.split("-");
      fromVal = p[0] + "-" + p[1].padStart(2, "0") + "-" + p[2].padStart(2, "0");
      $("#reports_view #rep_date_from").val(fromVal);
    }
    if (toVal && /^\d{4}-\d{1,2}-\d{1,2}$/.test(toVal)) {
      const p = toVal.split("-");
      toVal = p[0] + "-" + p[1].padStart(2, "0") + "-" + p[2].padStart(2, "0");
      $("#reports_view #rep_date_to").val(toVal);
    }

    const dates = { from: fromVal, to: toVal };

    $("#reports_view #active_report_thead").empty();
    $("#reports_view #active_report_tbody").empty();
    $("#reports_view #report_summary_container").empty();
    $("#reports_view #report_empty_state").hide();

    if (currentReportKey === "inventory") {
      $("#reports_view #active_report_table").hide();
      $("#reports_view #table_original_inventory").show();
    } else {
      $("#reports_view #table_original_inventory").hide();
      $("#reports_view #active_report_table").show();
    }

    const reportTitles = {
      pnl: '<i class="fa fa-line-chart text-success"></i> Profit &amp; Loss Report',
      sales: '<i class="fa fa-shopping-cart text-primary"></i> Sales Summary Report',
      expenses: '<i class="fa fa-money text-warning"></i> Operating Expense Report',
      stock_valuation: '<i class="fa fa-calculator text-info"></i> Stock Valuation &amp; Margin Potential',
      expiry: '<i class="fa fa-calendar-times-o text-danger"></i> Medicine Expiry &amp; Short-Dated Report',
      low_stock: '<i class="fa fa-exclamation-triangle text-warning"></i> Low Stock &amp; Reorder Report',
      product_movement: '<i class="fa fa-arrows-h text-primary"></i> Top Selling &amp; Dead Stock Report',
      purchases: '<i class="fa fa-truck text-success"></i> Purchases &amp; Supplier Discounts Report',
      payables_aging: '<i class="fa fa-clock-o text-danger"></i> Supplier Payables &amp; Customer Khata Aging',
      daily_closing: '<i class="fa fa-check-circle text-info"></i> Daily Closing &amp; Reconciliation Report',
      inventory: '<i class="fa fa-table text-muted"></i> Inventory Stock (Original)'
    };

    $("#reports_view #active_report_title").html(reportTitles[currentReportKey] || "Report");
    $("#reports_view #print_header_report_name").text($("#reports_view #active_report_title").text());

    let rangeText = "";
    if (currentReportKey === "daily_closing") {
      rangeText = "Date: " + (dates.from || getTodayKarachi());
    } else if (["pnl", "sales", "expenses", "purchases"].includes(currentReportKey)) {
      rangeText = "Period: " + (dates.from || "All") + " to " + (dates.to || "All");
    } else {
      rangeText = "As of: " + getTodayKarachi();
    }
    $("#reports_view #active_report_subtitle").text(rangeText);
    $("#reports_view #print_header_period").text(rangeText);

    switch (currentReportKey) {
      case "pnl":
        renderPnlReport(dates);
        break;
      case "sales":
        renderSalesReport(dates);
        break;
      case "expenses":
        renderExpensesReport(dates);
        break;
      case "stock_valuation":
        renderStockValuationReport();
        break;
      case "expiry":
        renderExpiryReport();
        break;
      case "low_stock":
        renderLowStockReport();
        break;
      case "product_movement":
        renderProductMovementReport();
        break;
      case "purchases":
        renderPurchasesReport(dates);
        break;
      case "payables_aging":
        renderPayablesAgingReport();
        break;
      case "daily_closing":
        renderDailyClosingReport(dates.from);
        break;
      case "inventory":
        renderOriginalInventoryReport();
        break;
    }
  }

  // 1. PROFIT & LOSS REPORT
  function renderPnlReport(dates) {
    apiAjax(`reports/profit-loss?start=${dates.from}&end=${dates.to}`, { type: "GET" })
      .done(function (res) {
        const s = res.summary;
        let unknownAlert = "";
        if (s.unknownCount > 0) {
          unknownAlert = `
            <div class="alert alert-warning" style="padding:10px 14px; margin-top:10px; font-size:12px; border-left:4px solid #f59e0b;">
              <i class="fa fa-exclamation-triangle"></i> <strong>Incomplete Profit Calculation:</strong> ${s.unknownCount} sales (${formatMoney(s.unknownAmount)}) have unknown purchase cost (opening stock / missing purchase bills). Net profit cannot be determined accurately until purchase bills are entered. Shown gross profit reflects sales with known cost.
            </div>
          `;
        }

        let npDisplay = "—";
        let npClass = "text-muted";
        let npSub = "Margin: <strong>—</strong>";

        if (s.isIncomplete) {
          npDisplay = '<span class="text-muted font-weight-bold">—</span>';
          npSub = '<span class="badge" style="background:#fef3c7; color:#92400e; font-size:10px;">Incomplete</span> Net margin: —';
        } else {
          const npVal = Number(s.netProfitCents || 0);
          npClass = npVal < 0 ? "text-danger" : "text-success";
          const npSign = npVal < 0 ? "-" : "";
          npDisplay = npSign + formatMoney(Math.abs(npVal) / 100);
          npSub = `Margin: <strong>${s.marginPct}</strong>`;
        }

        $("#reports_view #report_summary_container").html(`
          <div class="report-kpi-grid">
            <div class="report-kpi-card" style="border-left: 4px solid #3b82f6;">
              <div class="report-kpi-title">Net Sales (All)</div>
              <div class="report-kpi-val">${formatMoney(s.netSales)}</div>
              <div class="report-kpi-sub">${s.totalBills} bills &bull; Known: ${s.knownBills} &bull; Disc: ${formatMoney(s.discountsGiven)}</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #64748b;">
              <div class="report-kpi-title">Cost of Goods (COGS)</div>
              <div class="report-kpi-val">${s.cogs === "—" ? "—" : formatMoney(s.cogs)}</div>
              <div class="report-kpi-sub">Cost of costed sales only</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #10b981;">
              <div class="report-kpi-title">Gross Profit</div>
              <div class="report-kpi-val">${s.grossProfit === "—" ? "—" : formatMoney(s.grossProfit)}</div>
              <div class="report-kpi-sub">Margin: <strong>${s.grossMarginPct || '—'}</strong></div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #f59e0b;">
              <div class="report-kpi-title">Operating Expenses</div>
              <div class="report-kpi-val">${formatMoney(s.expenses)}</div>
              <div class="report-kpi-sub">Rent, utilities, staff &amp; others</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid ${s.isIncomplete ? '#94a3b8' : (Number(s.netProfitCents || 0) < 0 ? '#ef4444' : '#06b6d4')};">
              <div class="report-kpi-title">Net Profit</div>
              <div class="report-kpi-val ${npClass}">${npDisplay}</div>
              <div class="report-kpi-sub">${npSub}</div>
            </div>
          </div>
          ${unknownAlert}
        `);

        $("#reports_view #active_report_thead").html(`
          <tr>
            <th>Income / Expense Category</th>
            <th class="text-right">Amount</th>
            <th class="text-right">% of Net Sales</th>
          </tr>
        `);

        const netSalesNum = Math.max(1, parseFloat(String(s.netSales).replace(/,/g, '')));
        let rows = `
          <tr style="font-weight:700; background:rgba(59, 130, 246, 0.06);">
            <td><i class="fa fa-shopping-cart text-primary m-r-5"></i> Net Sales Revenue (All ${s.totalBills} Bills)</td>
            <td class="text-right">${formatMoney(s.netSales)}</td>
            <td class="text-right">100.0%</td>
          </tr>
          <tr>
            <td style="padding-left:25px;">- Sales with Known Cost (${s.knownBills} bills)</td>
            <td class="text-right">${formatMoney(s.knownSales)}</td>
            <td class="text-right">${((parseFloat(String(s.knownSales).replace(/,/g, '')) / netSalesNum) * 100).toFixed(1)}%</td>
          </tr>
          <tr>
            <td style="padding-left:25px;">- Sales with Unknown Cost (${s.unknownCount} bills)</td>
            <td class="text-right text-muted">${formatMoney(s.unknownAmount)}</td>
            <td class="text-right text-muted">${((parseFloat(String(s.unknownAmount).replace(/,/g, '')) / netSalesNum) * 100).toFixed(1)}%</td>
          </tr>
          <tr>
            <td style="padding-left:25px;">Less: Cost of Goods Sold (COGS on Costed Sales)</td>
            <td class="text-right text-muted">${s.cogs === "—" ? "—" : "(" + formatMoney(s.cogs) + ")"}</td>
            <td class="text-right text-muted">${s.cogs === "—" ? "—" : ((parseFloat(String(s.cogs).replace(/,/g, '')) / netSalesNum) * 100).toFixed(1) + "%"}</td>
          </tr>
          <tr style="font-weight:700; background:rgba(16, 185, 129, 0.06);">
            <td><i class="fa fa-line-chart text-success m-r-5"></i> Gross Profit (Known Cost Sales &minus; COGS)</td>
            <td class="text-right font-weight-bold">${s.grossProfit === "—" ? "—" : formatMoney(s.grossProfit)}</td>
            <td class="text-right font-weight-bold">${s.grossMarginPct || '—'}</td>
          </tr>
          <tr class="info" style="font-weight:700;">
            <td colspan="3"><i class="fa fa-money text-warning m-r-5"></i> Operating Expenses</td>
          </tr>
        `;

        (res.expensesByCategory || []).forEach(ec => {
          rows += `
            <tr>
              <td style="padding-left:25px;">${DOMPurify.sanitize(ec.categoryName)}</td>
              <td class="text-right">${formatMoney(ec.amount)}</td>
              <td class="text-right">${((parseFloat(String(ec.amount).replace(/,/g, '')) / netSalesNum) * 100).toFixed(1)}%</td>
            </tr>
          `;
        });

        rows += `
          <tr style="font-weight:700;">
            <td style="padding-left:25px;">Total Operating Expenses</td>
            <td class="text-right text-warning">(${formatMoney(s.expenses)})</td>
            <td class="text-right text-warning">${((parseFloat(String(s.expenses).replace(/,/g, '')) / netSalesNum) * 100).toFixed(1)}%</td>
          </tr>
          <tr style="font-size:15px; font-weight:800; border-top:2px solid #334155; border-bottom:2px solid #334155;">
            <td>NET PROFIT / (LOSS)</td>
            <td class="text-right ${npClass}">${npDisplay}</td>
            <td class="text-right ${npClass}">${s.isIncomplete ? '—' : s.marginPct}</td>
          </tr>
        `;

        $("#reports_view #active_report_tbody").html(rows);
      })
      .fail(function (xhr) {
        $("#reports_view #active_report_tbody").empty();
        if (xhr.status === 403) {
          $("#reports_view #report_summary_container").html('<div class="alert alert-warning"><i class="fa fa-lock"></i> Permission Denied: Profit and financial reports are restricted to authorized users.</div>');
        } else {
          $("#reports_view #report_summary_container").html('<div class="alert alert-danger"><i class="fa fa-exclamation-circle"></i> ' + DOMPurify.sanitize(xhr.responseJSON?.message || xhr.responseJSON?.error || "Failed to load Profit & Loss report") + '</div>');
        }
      });
  }

  // 2. SALES REPORT
  function renderSalesReport(dates) {
    const groupBy = $("#reports_view #rep_filter_sales_group").val() || "day";
    apiAjax(`reports/sales?start=${dates.from}&end=${dates.to}&groupBy=${groupBy}`, { type: "GET" })
      .done(function (res) {
        const s = res.summary;
        $("#reports_view #report_summary_container").html(`
          <div class="report-kpi-grid">
            <div class="report-kpi-card" style="border-left: 4px solid #3b82f6;">
              <div class="report-kpi-title">Total Bills</div>
              <div class="report-kpi-val">${s.totalBills}</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #10b981;">
              <div class="report-kpi-title">Total Sales</div>
              <div class="report-kpi-val">${formatMoney(s.totalSales)}</div>
            </div>
            <div class="report-kpi-card">
              <div class="report-kpi-title">Cash Sales</div>
              <div class="report-kpi-val text-success">${formatMoney(s.cashSales)}</div>
            </div>
            <div class="report-kpi-card">
              <div class="report-kpi-title">Khata (Credit) Sales</div>
              <div class="report-kpi-val text-warning">${formatMoney(s.khataSales)}</div>
            </div>
            <div class="report-kpi-card">
              <div class="report-kpi-title">Mixed Payment Sales</div>
              <div class="report-kpi-val text-info">${formatMoney(s.mixedSales)}</div>
            </div>
          </div>
        `);

        $("#reports_view #active_report_thead").html(`
          <tr>
            <th>${groupBy === 'month' ? 'Month' : 'Date'}</th>
            <th class="text-right">Bills</th>
            <th class="text-right">Cash Sales</th>
            <th class="text-right">Khata Sales</th>
            <th class="text-right">Mixed Sales</th>
            <th class="text-right font-weight-bold">Total Sales</th>
          </tr>
        `);

        let rows = "";
        (res.rows || []).forEach(r => {
          rows += `
            <tr>
              <td><strong>${r.period}</strong></td>
              <td class="text-right">${r.bills}</td>
              <td class="text-right">${formatMoney(r.cashSales)}</td>
              <td class="text-right">${formatMoney(r.khataSales)}</td>
              <td class="text-right">${formatMoney(r.mixedSales)}</td>
              <td class="text-right font-weight-bold">${formatMoney(r.totalSales)}</td>
            </tr>
          `;
        });
        if (!rows) {
          $("#reports_view #active_report_tbody").empty();
          $("#reports_view #report_empty_state").show();
        } else {
          $("#reports_view #report_empty_state").hide();
          $("#reports_view #active_report_tbody").html(rows);
        }
      })
      .fail(function (xhr) {
        $("#reports_view #active_report_tbody").empty();
        $("#reports_view #report_summary_container").html('<div class="alert alert-danger"><i class="fa fa-exclamation-circle"></i> ' + DOMPurify.sanitize(xhr.responseJSON?.message || xhr.responseJSON?.error || "Failed to load Sales report") + '</div>');
      });
  }

  // 3. EXPENSES REPORT
  function renderExpensesReport(dates) {
    apiAjax(`reports/expenses?start=${dates.from}&end=${dates.to}`, { type: "GET" })
      .done(function (res) {
        const s = res.summary;
        $("#reports_view #report_summary_container").html(`
          <div class="report-kpi-grid">
            <div class="report-kpi-card" style="border-left: 4px solid #f59e0b;">
              <div class="report-kpi-title">Total Vouchers</div>
              <div class="report-kpi-val">${s.totalCount}</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #ef4444;">
              <div class="report-kpi-title">Total Expenses</div>
              <div class="report-kpi-val text-danger">${formatMoney(s.totalAmount)}</div>
            </div>
          </div>
        `);

        $("#reports_view #active_report_thead").html(`
          <tr>
            <th>Date</th>
            <th>Voucher #</th>
            <th>Category</th>
            <th>Description</th>
            <th>Payment Method</th>
            <th class="text-right">Amount</th>
            <th>Recorded By</th>
          </tr>
        `);

        let rows = "";
        (res.rows || []).forEach(r => {
          rows += `
            <tr>
              <td>${r.date}</td>
              <td><strong>${r.expenseNumber}</strong></td>
              <td><span class="badge" style="background:#f1f5f9; color:#334155;">${DOMPurify.sanitize(r.category)}</span></td>
              <td>${DOMPurify.sanitize(r.description)}</td>
              <td>${r.paymentMethod}</td>
              <td class="text-right font-weight-bold text-danger">${formatMoney(r.amount)}</td>
              <td>${DOMPurify.sanitize(r.user)}</td>
            </tr>
          `;
        });
        if (!rows) {
          $("#reports_view #active_report_tbody").empty();
          $("#reports_view #report_empty_state").show();
        } else {
          $("#reports_view #report_empty_state").hide();
          $("#reports_view #active_report_tbody").html(rows);
        }
      })
      .fail(function (xhr) {
        $("#reports_view #active_report_tbody").empty();
        $("#reports_view #report_summary_container").html('<div class="alert alert-danger"><i class="fa fa-exclamation-circle"></i> ' + DOMPurify.sanitize(xhr.responseJSON?.message || xhr.responseJSON?.error || "Failed to load Expenses report") + '</div>');
      });
  }

  // 4. STOCK VALUATION REPORT
  function renderStockValuationReport() {
    apiAjax("reports/stock-valuation", { type: "GET" })
      .done(function (res) {
        const s = res.summary;
        const profitVal = s.potentialGrossProfit || s.potentialProfit || "0.00";
        const marginVal = s.overallMarginPct || s.marginPct || "0.0";
        const marginDisplay = String(marginVal).includes("%") ? marginVal : marginVal + "%";

        $("#reports_view #report_summary_container").html(`
          <div class="report-kpi-grid">
            <div class="report-kpi-card" style="border-left: 4px solid #3b82f6;">
              <div class="report-kpi-title">Total Medicines</div>
              <div class="report-kpi-val">${s.totalMedicines}</div>
              <div class="report-kpi-sub">${s.totalQuantity} total units on hand</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #64748b;">
              <div class="report-kpi-title">Total Cost Value</div>
              <div class="report-kpi-val">${formatMoney(s.totalCostValue)}</div>
              <div class="report-kpi-sub">At effective purchase cost</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #10b981;">
              <div class="report-kpi-title">Total Retail Value</div>
              <div class="report-kpi-val">${formatMoney(s.totalRetailValue)}</div>
              <div class="report-kpi-sub">At store selling prices</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #06b6d4;">
              <div class="report-kpi-title">Potential Profit</div>
              <div class="report-kpi-val text-success font-weight-bold">${formatMoney(profitVal)}</div>
              <div class="report-kpi-sub">Margin: <strong>${marginDisplay}</strong></div>
            </div>
          </div>
        `);

        $("#reports_view #active_report_thead").html(`
          <tr>
            <th>Barcode</th>
            <th>Medicine Name</th>
            <th>Category</th>
            <th class="text-right">Qty</th>
            <th class="text-right">Unit Cost</th>
            <th class="text-right">Total Cost</th>
            <th class="text-right">Unit Price</th>
            <th class="text-right">Total Retail</th>
            <th class="text-right font-weight-bold">Profit Pot.</th>
            <th class="text-right">Margin %</th>
          </tr>
        `);

        let rows = "";
        const list = res.medicines || res.rows || [];
        list.forEach(m => {
          const mName = m.name || m.productName || "";
          const mCost = m.totalCost || m.costValue;
          const mPrice = m.unitPrice || m.retailPrice;
          const mRetail = m.totalRetail || m.retailValue;
          const mMargin = String(m.marginPct || "0.0").includes("%") ? m.marginPct : m.marginPct + "%";

          const qtyCell = (m.pack_display && m.pack_display !== String(m.quantity)) ? `${DOMPurify.sanitize(m.pack_display)} (${m.quantity})` : m.quantity;
          rows += `
            <tr>
              <td>${m.barcode || "-"}</td>
              <td class="medicine-name-cell" title="${escapeHtml(mName)}"><strong>${DOMPurify.sanitize(mName)}</strong></td>
              <td>${DOMPurify.sanitize(m.category || "-")}</td>
              <td class="text-right">${qtyCell}</td>
              <td class="text-right">${formatMoney(m.unitCost)}</td>
              <td class="text-right">${formatMoney(mCost)}</td>
              <td class="text-right">${formatMoney(mPrice)}</td>
              <td class="text-right">${formatMoney(mRetail)}</td>
              <td class="text-right font-weight-bold text-success">${formatMoney(m.potentialProfit)}</td>
              <td class="text-right">${mMargin}</td>
            </tr>
          `;
        });
        if (!rows) {
          $("#reports_view #active_report_tbody").empty();
          $("#reports_view #report_empty_state").show();
        } else {
          $("#reports_view #report_empty_state").hide();
          $("#reports_view #active_report_tbody").html(rows);
        }
      })
      .fail(function (xhr) {
        $("#reports_view #active_report_tbody").empty();
        if (xhr.status === 403) {
          $("#reports_view #report_summary_container").html('<div class="alert alert-warning"><i class="fa fa-lock"></i> Permission Denied: Stock valuation data is restricted to authorized roles.</div>');
        } else {
          $("#reports_view #report_summary_container").html('<div class="alert alert-danger"><i class="fa fa-exclamation-circle"></i> ' + DOMPurify.sanitize(xhr.responseJSON?.message || xhr.responseJSON?.error || "Failed to load Stock Valuation report") + '</div>');
        }
      });
  }

  // 5. MEDICINE EXPIRY & SHORT-DATED REPORT
  function renderExpiryReport() {
    const bucket = $("#reports_view #rep_filter_expiry_bucket").val() || "all";
    apiAjax(`reports/expiry?bucket=${bucket}`, { type: "GET" })
      .done(function (res) {
        const s = res.summary;
        const expCount = s.expiredCount !== undefined ? s.expiredCount : (s.expiredUnits || 0);
        const expCostVal = s.expiredCostValue || s.expiredValue || "0.00";
        const w30Count = s.within30DaysCount !== undefined ? s.within30DaysCount : (s.exp30Units || 0);
        const w30CostVal = s.within30DaysCostValue || s.exp30Value || "0.00";
        const w60Count = s.within60DaysCount !== undefined ? s.within60DaysCount : (s.exp60Units || 0);
        const w90Count = s.within90DaysCount !== undefined ? s.within90DaysCount : (s.exp90Units || 0);
        const atRiskVal = s.totalAtRiskCostValue || "0.00";
        const atRiskBatches = s.totalAtRiskBatches !== undefined ? s.totalAtRiskBatches : (expCount + w30Count + w60Count + w90Count);

        $("#reports_view #report_summary_container").html(`
          <div class="report-kpi-grid">
            <div class="report-kpi-card" style="border-left: 4px solid #ef4444;">
              <div class="report-kpi-title">Expired Batches</div>
              <div class="report-kpi-val text-danger">${expCount}</div>
              <div class="report-kpi-sub">Loss value: ${formatMoney(expCostVal)}</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #f97316;">
              <div class="report-kpi-title">&le; 30 Days Left</div>
              <div class="report-kpi-val text-warning font-weight-bold">${w30Count}</div>
              <div class="report-kpi-sub">Value: ${formatMoney(w30CostVal)}</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #eab308;">
              <div class="report-kpi-title">31 &ndash; 60 Days Left</div>
              <div class="report-kpi-val font-weight-bold">${w60Count}</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #3b82f6;">
              <div class="report-kpi-title">61 &ndash; 90 Days Left</div>
              <div class="report-kpi-val">${w90Count}</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #64748b;">
              <div class="report-kpi-title">Total At-Risk Stock Value</div>
              <div class="report-kpi-val font-weight-bold text-danger">${formatMoney(atRiskVal)}</div>
              <div class="report-kpi-sub">${atRiskBatches} total batches</div>
            </div>
          </div>
        `);

        $("#reports_view #active_report_thead").html(`
          <tr>
            <th>Barcode</th>
            <th>Medicine Name</th>
            <th>Batch #</th>
            <th>Expiry Date</th>
            <th class="text-right">Days Left</th>
            <th class="text-right">Current Stock</th>
            <th class="text-right">Unit Cost</th>
            <th class="text-right font-weight-bold">Cost Value</th>
            <th>Supplier</th>
            <th>Risk Level</th>
          </tr>
        `);

        let rows = "";
        const list = res.batches || res.rows || [];
        list.forEach(b => {
          const bName = b.productName || b.name || "";
          const daysLeftVal = b.daysUntilExpiry !== undefined ? b.daysUntilExpiry : (b.daysLeft !== undefined ? b.daysLeft : 0);
          const bCostVal = b.costValue || b.totalCostValue || 0;
          const isExpired = b.isExpired !== undefined ? b.isExpired : (daysLeftVal < 0);

          let riskLevelKey = b.riskLevel;
          if (!riskLevelKey) {
            if (daysLeftVal < 0) riskLevelKey = "expired";
            else if (daysLeftVal <= 30) riskLevelKey = "30_days";
            else if (daysLeftVal <= 60) riskLevelKey = "60_days";
            else if (daysLeftVal <= 90) riskLevelKey = "90_days";
            else riskLevelKey = "good";
          }

          let riskBadge = '<span class="badge" style="background:#10b981; color:#fff;">Good</span>';
          if (riskLevelKey === "expired") {
            riskBadge = '<span class="badge" style="background:#ef4444; color:#fff; font-weight:700;">EXPIRED</span>';
          } else if (riskLevelKey === "30_days") {
            riskBadge = '<span class="badge" style="background:#f97316; color:#fff; font-weight:700;">&le; 30 DAYS</span>';
          } else if (riskLevelKey === "60_days") {
            riskBadge = '<span class="badge" style="background:#eab308; color:#000;">&le; 60 DAYS</span>';
          } else if (riskLevelKey === "90_days") {
            riskBadge = '<span class="badge" style="background:#3b82f6; color:#fff;">&le; 90 DAYS</span>';
          }

          const bQtyCell = (b.pack_display && b.pack_display !== String(b.quantity)) ? `${DOMPurify.sanitize(b.pack_display)} (${b.quantity})` : b.quantity;
          rows += `
            <tr class="${isExpired ? 'danger' : (daysLeftVal <= 30 ? 'warning' : '')}">
              <td>${b.barcode || "-"}</td>
              <td class="medicine-name-cell" title="${escapeHtml(bName)}"><strong>${DOMPurify.sanitize(bName)}</strong></td>
              <td>${DOMPurify.sanitize(b.batchNumber || "-")}</td>
              <td>${b.expiryDate}</td>
              <td class="text-right font-weight-bold ${daysLeftVal < 0 ? 'text-danger' : (daysLeftVal <= 30 ? 'text-warning' : '')}">${daysLeftVal}</td>
              <td class="text-right">${bQtyCell}</td>
              <td class="text-right">${formatMoney(b.unitCost)}</td>
              <td class="text-right font-weight-bold">${formatMoney(bCostVal)}</td>
              <td>${DOMPurify.sanitize(b.supplier || "-")}</td>
              <td>${riskBadge}</td>
            </tr>
          `;
        });
        if (!rows) {
          $("#reports_view #active_report_tbody").empty();
          $("#reports_view #report_empty_state").show();
        } else {
          $("#reports_view #report_empty_state").hide();
          $("#reports_view #active_report_tbody").html(rows);
        }
      })
      .fail(function (xhr) {
        $("#reports_view #active_report_tbody").empty();
        $("#reports_view #report_summary_container").html('<div class="alert alert-danger"><i class="fa fa-exclamation-circle"></i> ' + DOMPurify.sanitize(xhr.responseJSON?.message || xhr.responseJSON?.error || "Failed to load Expiry report") + '</div>');
      });
  }

  // 6. LOW STOCK & REORDER REPORT
  function renderLowStockReport() {
    apiAjax("reports/low-stock", { type: "GET" })
      .done(function (res) {
        const s = res.summary;
        const outCount = s.outOfStockCount !== undefined ? s.outOfStockCount : (s.outOfStockMedicines || 0);
        const lowCount = s.belowMinStockCount !== undefined ? s.belowMinStockCount : (s.lowStockMedicines || 0);
        const reorderUnits = s.totalSuggestedReorderQty !== undefined ? s.totalSuggestedReorderQty : (s.totalDeficitUnits || 0);
        const reorderVal = s.totalReorderCost || s.totalRestockCost || "0.00";

        $("#reports_view #report_summary_container").html(`
          <div class="report-kpi-grid">
            <div class="report-kpi-card" style="border-left: 4px solid #ef4444;">
              <div class="report-kpi-title">Out of Stock Items</div>
              <div class="report-kpi-val text-danger">${outCount}</div>
              <div class="report-kpi-sub">Critical replenishment needed</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #f59e0b;">
              <div class="report-kpi-title">Below Min Stock</div>
              <div class="report-kpi-val text-warning">${lowCount}</div>
              <div class="report-kpi-sub">At or under alert threshold</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #3b82f6;">
              <div class="report-kpi-title">Suggested Reorder Qty</div>
              <div class="report-kpi-val font-weight-bold">${reorderUnits}</div>
              <div class="report-kpi-sub">Est. Reorder Cost: ${formatMoney(reorderVal)}</div>
            </div>
          </div>
        `);

        $("#reports_view #active_report_thead").html(`
          <tr>
            <th>Barcode</th>
            <th>Medicine Name</th>
            <th>Category</th>
            <th>Supplier</th>
            <th class="text-right">Current Stock</th>
            <th class="text-right">Min Threshold</th>
            <th class="text-right">Shortage</th>
            <th class="text-right font-weight-bold text-success">Suggested Order</th>
            <th class="text-right">Est. Cost</th>
            <th>Status</th>
          </tr>
        `);

        let rows = "";
        const list = res.lowStockItems || res.rows || [];
        list.forEach(p => {
          const pName = p.name || p.productName || "";
          const curStock = p.currentStock !== undefined ? p.currentStock : p.quantity;
          const shortage = p.shortage !== undefined ? p.shortage : p.deficit;
          const orderQty = p.suggestedReorder !== undefined ? p.suggestedReorder : p.deficit;
          const estCost = p.reorderCost || p.estimatedRestockCost;
          const isOut = p.isOutOfStock !== undefined ? p.isOutOfStock : (Number(curStock) <= 0);

          let statusBadge = '<span class="badge" style="background:#f59e0b; color:#fff;">LOW STOCK</span>';
          if (isOut) {
            statusBadge = '<span class="badge" style="background:#ef4444; color:#fff; font-weight:700;">OUT OF STOCK</span>';
          }

          const stockCell = (p.pack_display && p.pack_display !== String(curStock)) ? `${DOMPurify.sanitize(p.pack_display)} (${curStock})` : curStock;
          rows += `
            <tr class="${isOut ? 'danger' : 'warning'}">
              <td>${p.barcode || "-"}</td>
              <td class="medicine-name-cell" title="${escapeHtml(pName)}"><strong>${DOMPurify.sanitize(pName)}</strong></td>
              <td>${DOMPurify.sanitize(p.category || "-")}</td>
              <td>${DOMPurify.sanitize(p.supplier || "-")}</td>
              <td class="text-right font-weight-bold ${isOut ? 'text-danger' : 'text-warning'}">${stockCell}</td>
              <td class="text-right">${p.minStock}</td>
              <td class="text-right text-danger font-weight-bold">${shortage}</td>
              <td class="text-right font-weight-bold text-success">${orderQty}</td>
              <td class="text-right">${formatMoney(estCost)}</td>
              <td>${statusBadge}</td>
            </tr>
          `;
        });
        if (!rows) {
          $("#reports_view #active_report_tbody").empty();
          $("#reports_view #report_empty_state").show();
        } else {
          $("#reports_view #report_empty_state").hide();
          $("#reports_view #active_report_tbody").html(rows);
        }
      })
      .fail(function (xhr) {
        $("#reports_view #active_report_tbody").empty();
        $("#reports_view #report_summary_container").html('<div class="alert alert-danger"><i class="fa fa-exclamation-circle"></i> ' + DOMPurify.sanitize(xhr.responseJSON?.message || xhr.responseJSON?.error || "Failed to load Low Stock report") + '</div>');
      });
  }

  // 7. PRODUCT MOVEMENT (TOP SELLING & DEAD STOCK)
  function renderProductMovementReport() {
    const days = $("#reports_view #rep_filter_movement_days").val() || 90;
    apiAjax(`reports/product-movement?days=${days}`, { type: "GET" })
      .done(function (res) {
        const deadCount = res.deadStockSummary?.count !== undefined ? res.deadStockSummary.count : (res.summary?.deadStockCount || (res.deadStock || []).length);
        const deadTiedUp = res.deadStockSummary?.tiedUpCapital || res.summary?.deadStockTiedUpValue || "0.00";

        $("#reports_view #report_summary_container").html(`
          <div class="report-kpi-grid">
            <div class="report-kpi-card" style="border-left: 4px solid #10b981;">
              <div class="report-kpi-title">Top Sellers Count</div>
              <div class="report-kpi-val text-success">${(res.topSelling || []).length}</div>
              <div class="report-kpi-sub">Highest velocity products</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #ef4444;">
              <div class="report-kpi-title">Dead Stock Products</div>
              <div class="report-kpi-val text-danger">${deadCount}</div>
              <div class="report-kpi-sub">0 sales in last ${days} days</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #64748b;">
              <div class="report-kpi-title">Tied-Up Capital in Dead Stock</div>
              <div class="report-kpi-val font-weight-bold text-danger">${formatMoney(deadTiedUp)}</div>
              <div class="report-kpi-sub">Consider discounting or returns</div>
            </div>
          </div>
        `);

        $("#reports_view #active_report_thead").html(`
          <tr class="success">
            <th colspan="6">TOP 25 FAST-MOVING MEDICINES (LAST ${days} DAYS)</th>
          </tr>
          <tr>
            <th>Barcode</th>
            <th>Medicine Name</th>
            <th>Category</th>
            <th>Last Sold Date</th>
            <th class="text-right">Units Sold</th>
            <th class="text-right font-weight-bold">Revenue</th>
          </tr>
        `);

        let rows = "";
        (res.topSelling || []).forEach(p => {
          const pName = p.productName || p.name || p.medicineName || "";
          const qtyText = p.pack_display ? `${DOMPurify.sanitize(p.pack_display)} <span class="text-muted" style="font-size:0.85em; font-weight:normal;">(${p.quantitySold})</span>` : p.quantitySold;
          rows += `
            <tr>
              <td>${p.barcode || "-"}</td>
              <td class="medicine-name-cell" title="${escapeHtml(pName)}"><strong>${DOMPurify.sanitize(pName)}</strong></td>
              <td>${DOMPurify.sanitize(p.category || "-")}</td>
              <td>${p.lastSaleDate || "-"}</td>
              <td class="text-right font-weight-bold text-success">${qtyText}</td>
              <td class="text-right font-weight-bold">${formatMoney(p.revenue)}</td>
            </tr>
          `;
        });

        rows += `
          <tr class="danger" style="font-weight:700;">
            <th colspan="6">DEAD STOCK: MEDICINES WITH ZERO SALES IN LAST ${days} DAYS</th>
          </tr>
          <tr style="font-weight:600; background:rgba(0,0,0,0.03);">
            <th>Barcode</th>
            <th>Medicine Name</th>
            <th>Category</th>
            <th>Last Sold Date</th>
            <th class="text-right">Current Stock</th>
            <th class="text-right font-weight-bold">Value Tied Up</th>
          </tr>
        `;

        (res.deadStock || []).forEach(p => {
          const dName = p.name || p.productName || p.medicineName || "";
          let lastSold = p.lastSaleDate || "Never sold";
          if (lastSold === "Never") lastSold = "Never sold";
          const qtyText = p.pack_display ? `${DOMPurify.sanitize(p.pack_display)} <span class="text-muted" style="font-size:0.85em;">(${p.quantity})</span>` : p.quantity;

          rows += `
            <tr>
              <td>${p.barcode || "-"}</td>
              <td class="medicine-name-cell" title="${escapeHtml(dName)}"><strong>${DOMPurify.sanitize(dName)}</strong></td>
              <td>${DOMPurify.sanitize(p.category || "-")}</td>
              <td>${lastSold}</td>
              <td class="text-right text-muted">${qtyText}</td>
              <td class="text-right font-weight-bold text-danger">${formatMoney(p.tiedUpCapital || p.tiedUpCost)}</td>
            </tr>
          `;
        });

        if (!rows) {
          $("#reports_view #active_report_tbody").empty();
          $("#reports_view #report_empty_state").show();
        } else {
          $("#reports_view #report_empty_state").hide();
          $("#reports_view #active_report_tbody").html(rows);
        }
      })
      .fail(function (xhr) {
        $("#reports_view #active_report_tbody").empty();
        $("#reports_view #report_summary_container").html('<div class="alert alert-danger"><i class="fa fa-exclamation-circle"></i> ' + DOMPurify.sanitize(xhr.responseJSON?.message || xhr.responseJSON?.error || "Failed to load Product Movement report") + '</div>');
      });
  }

  // 8. PURCHASES & SUPPLIER DISCOUNTS REPORT
  function renderPurchasesReport(dates) {
    apiAjax(`reports/purchases?start=${dates.from}&end=${dates.to}`, { type: "GET" })
      .done(function (res) {
        const s = res.summary;
        const invCount = s.invoiceCount !== undefined ? s.invoiceCount : (s.totalPurchasesCount || 0);
        const grossVal = s.grossPurchases || "0.00";
        const discVal = s.totalDiscountsReceived || s.discountReceived || "0.00";
        const netVal = s.netPurchases || "0.00";
        const outBal = s.outstandingBalance || s.balancePayable || "0.00";
        const paidVal = s.totalPaid || s.paidPurchases || "0.00";

        $("#reports_view #report_summary_container").html(`
          <div class="report-kpi-grid">
            <div class="report-kpi-card" style="border-left: 4px solid #3b82f6;">
              <div class="report-kpi-title">Total Invoices</div>
              <div class="report-kpi-val">${invCount}</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #10b981;">
              <div class="report-kpi-title">Gross Purchases</div>
              <div class="report-kpi-val">${formatMoney(grossVal)}</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #06b6d4;">
              <div class="report-kpi-title">Discounts Received</div>
              <div class="report-kpi-val text-success font-weight-bold">${formatMoney(discVal)}</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #64748b;">
              <div class="report-kpi-title">Net Purchases</div>
              <div class="report-kpi-val font-weight-bold">${formatMoney(netVal)}</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #ef4444;">
              <div class="report-kpi-title">Outstanding Payables</div>
              <div class="report-kpi-val text-danger font-weight-bold">${formatMoney(outBal)}</div>
              <div class="report-kpi-sub">Paid: ${formatMoney(paidVal)}</div>
            </div>
          </div>
        `);

        $("#reports_view #active_report_thead").html(`
          <tr>
            <th>Invoice #</th>
            <th>Supplier</th>
            <th>Invoice Date</th>
            <th>Receiving Date</th>
            <th class="text-right">Gross Total</th>
            <th class="text-right text-success">Discount Recv</th>
            <th class="text-right font-weight-bold">Net Total</th>
            <th class="text-right">Paid</th>
            <th class="text-right font-weight-bold">Balance</th>
            <th>Status</th>
          </tr>
        `);

        let rows = "";
        (res.rows || []).forEach(r => {
          rows += `
            <tr>
              <td><strong>${r.invoiceNo}</strong></td>
              <td>${DOMPurify.sanitize(r.supplier)}</td>
              <td>${r.invoiceDate}</td>
              <td>${r.receivingDate}</td>
              <td class="text-right">${formatMoney(r.grossTotal)}</td>
              <td class="text-right text-success">${formatMoney(r.discountReceived)}</td>
              <td class="text-right font-weight-bold">${formatMoney(r.netTotal)}</td>
              <td class="text-right">${formatMoney(r.paidAmount)}</td>
              <td class="text-right font-weight-bold ${parseFloat(String(r.balance).replace(/,/g, '')) > 0 ? 'text-danger' : 'text-success'}">${formatMoney(r.balance)}</td>
              <td><span class="badge" style="background:#e2e8f0; color:#334155;">${r.paymentStatus}</span></td>
            </tr>
          `;
        });
        if (!rows) {
          $("#reports_view #active_report_tbody").empty();
          $("#reports_view #report_empty_state").show();
        } else {
          $("#reports_view #report_empty_state").hide();
          $("#reports_view #active_report_tbody").html(rows);
        }
      })
      .fail(function (xhr) {
        $("#reports_view #active_report_tbody").empty();
        if (xhr.status === 403) {
          $("#reports_view #report_summary_container").html('<div class="alert alert-warning"><i class="fa fa-lock"></i> Permission Denied: Purchase financial data is restricted to authorized roles.</div>');
        } else {
          $("#reports_view #report_summary_container").html('<div class="alert alert-danger"><i class="fa fa-exclamation-circle"></i> ' + DOMPurify.sanitize(xhr.responseJSON?.message || xhr.responseJSON?.error || "Failed to load Purchases report") + '</div>');
        }
      });
  }

  // 9. SUPPLIER PAYABLES & CUSTOMER KHATA AGING
  function renderPayablesAgingReport() {
    apiAjax("reports/payables-aging", { type: "GET" })
      .done(function (res) {
        const supp = res.suppliers;
        const cust = res.customers;

        $("#reports_view #report_summary_container").html(`
          <div class="report-kpi-grid">
            <div class="report-kpi-card" style="border-left: 4px solid #ef4444;">
              <div class="report-kpi-title">Supplier Payables (AP)</div>
              <div class="report-kpi-val text-danger">${formatMoney(supp.summary.totalPayables)}</div>
              <div class="report-kpi-sub">${supp.summary.overdueCount} overdue suppliers</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #f59e0b;">
              <div class="report-kpi-title">Customer Receivables (Khata)</div>
              <div class="report-kpi-val text-warning">${formatMoney(cust.summary.totalReceivables)}</div>
              <div class="report-kpi-sub">Total credit extended</div>
            </div>
            <div class="report-kpi-card">
              <div class="report-kpi-title">Khata Current (0-30d)</div>
              <div class="report-kpi-val text-info">${formatMoney(cust.summary.bucket0_30)}</div>
            </div>
            <div class="report-kpi-card">
              <div class="report-kpi-title">Khata Aged (31-60d)</div>
              <div class="report-kpi-val text-warning">${formatMoney(cust.summary.bucket31_60)}</div>
            </div>
            <div class="report-kpi-card">
              <div class="report-kpi-title">Khata Overdue (61d+)</div>
              <div class="report-kpi-val text-danger">${formatMoney((parseFloat(String(cust.summary.bucket61_90).replace(/,/g, '')) + parseFloat(String(cust.summary.bucket90Plus).replace(/,/g, ''))).toFixed(2))}</div>
            </div>
          </div>
        `);

        $("#reports_view #active_report_thead").html(`
          <tr class="info">
            <th colspan="7">CUSTOMER KHATA AGING SCHEDULE</th>
          </tr>
          <tr>
            <th>Customer Name</th>
            <th>Phone</th>
            <th class="text-right">Credit Limit</th>
            <th class="text-right font-weight-bold">Total Khata</th>
            <th class="text-right">0-30 Days</th>
            <th class="text-right">31-60 Days</th>
            <th class="text-right">61-90+ Days</th>
          </tr>
        `);

        let rows = "";
        (cust.rows || []).forEach(c => {
          rows += `
            <tr>
              <td><strong>${DOMPurify.sanitize(c.name)}</strong></td>
              <td>${DOMPurify.sanitize(c.phone)}</td>
              <td class="text-right">${formatMoney(c.creditLimit)}</td>
              <td class="text-right font-weight-bold text-danger">${formatMoney(c.totalBalance)}</td>
              <td class="text-right">${formatMoney(c.bucket0_30)}</td>
              <td class="text-right text-warning">${formatMoney(c.bucket31_60)}</td>
              <td class="text-right font-weight-bold text-danger">${formatMoney(c.bucket90Plus)}</td>
            </tr>
          `;
        });

        rows += `
          <tr class="danger" style="font-weight:700;">
            <th colspan="7">SUPPLIER OUTSTANDING PAYABLES</th>
          </tr>
        `;
        (supp.rows || []).forEach(s => {
          rows += `
            <tr>
              <td><strong>${DOMPurify.sanitize(s.name)}</strong></td>
              <td>${DOMPurify.sanitize(s.phone)}</td>
              <td>Terms: ${DOMPurify.sanitize(s.terms)} (${s.dueDays}d)</td>
              <td class="text-right font-weight-bold ${s.balanceCents > 0 ? 'text-danger' : ''}">${formatMoney(s.balance)}</td>
              <td colspan="3">${s.isOverdue ? '<span class="badge" style="background:#ef4444; color:#fff;">OVERDUE INVOICE</span>' : '<span class="badge" style="background:#10b981; color:#fff;">Current</span>'}</td>
            </tr>
          `;
        });

        if (!rows) {
          $("#reports_view #active_report_tbody").empty();
          $("#reports_view #report_empty_state").show();
        } else {
          $("#reports_view #report_empty_state").hide();
          $("#reports_view #active_report_tbody").html(rows);
        }
      })
      .fail(function (xhr) {
        $("#reports_view #active_report_tbody").empty();
        $("#reports_view #report_summary_container").html('<div class="alert alert-danger"><i class="fa fa-exclamation-circle"></i> ' + DOMPurify.sanitize(xhr.responseJSON?.message || xhr.responseJSON?.error || "Failed to load Payables Aging report") + '</div>');
      });
  }

  // 10. DAILY CLOSING REPORT
  function renderDailyClosingReport(dateStr) {
    const targetDate = dateStr || getTodayKarachi();
    apiAjax(`reports/daily-closing?date=${targetDate}`, { type: "GET" })
      .done(function (res) {
        $("#reports_view #report_summary_container").html(`
          <div class="report-kpi-grid">
            <div class="report-kpi-card" style="border-left: 4px solid #3b82f6;">
              <div class="report-kpi-title">Bills Completed</div>
              <div class="report-kpi-val">${res.billsCount}</div>
              <div class="report-kpi-sub">Total sales: ${formatMoney(res.totalSales)}</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #10b981;">
              <div class="report-kpi-title">Cash Collected (Sales)</div>
              <div class="report-kpi-val text-success">${formatMoney(res.cashCollectedFromSales)}</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #06b6d4;">
              <div class="report-kpi-title">Customer Khata Collected</div>
              <div class="report-kpi-val text-info">${formatMoney(res.customerKhataCollected)}</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #f59e0b;">
              <div class="report-kpi-title">Total Cash Inflows</div>
              <div class="report-kpi-val font-weight-bold text-success">${formatMoney(res.totalCashInflow)}</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #ef4444;">
              <div class="report-kpi-title">Total Cash Outflows</div>
              <div class="report-kpi-val font-weight-bold text-danger">${formatMoney(res.totalCashOutflow)}</div>
              <div class="report-kpi-sub">Suppliers: ${formatMoney(res.supplierPaymentsMade)} &bull; Exp: ${formatMoney(res.cashExpensesPaid)}</div>
            </div>
            <div class="report-kpi-card" style="border-left: 4px solid #8b5cf6;">
              <div class="report-kpi-title">Net Drawer Cash Flow</div>
              <div class="report-kpi-val font-weight-bold">${formatMoney(res.netDrawerChange)}</div>
              <div class="report-kpi-sub">Cashbook Bal: ${formatMoney(res.cashbookBalance)}</div>
            </div>
          </div>
        `);

        $("#reports_view #active_report_thead").html(`
          <tr>
            <th>Transaction Category / Source</th>
            <th class="text-right">Inflow (Cash In)</th>
            <th class="text-right">Outflow (Cash Out)</th>
            <th class="text-right font-weight-bold">Net Effect</th>
          </tr>
        `);

        const rows = `
          <tr style="background:rgba(16, 185, 129, 0.05);">
            <td><i class="fa fa-shopping-cart text-success m-r-5"></i> Cash Collected from Sales (${res.billsCount} bills)</td>
            <td class="text-right text-success font-weight-bold">${formatMoney(res.cashCollectedFromSales)}</td>
            <td class="text-right text-muted">—</td>
            <td class="text-right text-success font-weight-bold">+${formatMoney(res.cashCollectedFromSales)}</td>
          </tr>
          <tr style="background:rgba(6, 182, 212, 0.05);">
            <td><i class="fa fa-user-plus text-info m-r-5"></i> Customer Khata Debt Collected</td>
            <td class="text-right text-info font-weight-bold">${formatMoney(res.customerKhataCollected)}</td>
            <td class="text-right text-muted">—</td>
            <td class="text-right text-info font-weight-bold">+${formatMoney(res.customerKhataCollected)}</td>
          </tr>
          <tr style="background:rgba(239, 68, 68, 0.05);">
            <td><i class="fa fa-truck text-danger m-r-5"></i> Supplier Payments Made</td>
            <td class="text-right text-muted">—</td>
            <td class="text-right text-danger font-weight-bold">${formatMoney(res.supplierPaymentsMade)}</td>
            <td class="text-right text-danger font-weight-bold">-${formatMoney(res.supplierPaymentsMade)}</td>
          </tr>
          <tr style="background:rgba(245, 158, 11, 0.05);">
            <td><i class="fa fa-money text-warning m-r-5"></i> Operating Expenses Paid in Cash</td>
            <td class="text-right text-muted">—</td>
            <td class="text-right text-warning font-weight-bold">${formatMoney(res.cashExpensesPaid)}</td>
            <td class="text-right text-warning font-weight-bold">-${formatMoney(res.cashExpensesPaid)}</td>
          </tr>
          <tr style="font-size:15px; font-weight:800; border-top:2px solid #334155; border-bottom:2px solid #334155;">
            <td>NET DRAWER CASH CHANGE</td>
            <td class="text-right text-success font-weight-bold">${formatMoney(res.totalCashInflow)}</td>
            <td class="text-right text-danger font-weight-bold">${formatMoney(res.totalCashOutflow)}</td>
            <td class="text-right font-weight-bold">${formatMoney(res.netDrawerChange)}</td>
          </tr>
        `;
        $("#reports_view #active_report_tbody").html(rows);
      })
      .fail(function (xhr) {
        $("#reports_view #active_report_tbody").empty();
        $("#reports_view #report_summary_container").html('<div class="alert alert-danger"><i class="fa fa-exclamation-circle"></i> ' + DOMPurify.sanitize(xhr.responseJSON?.message || xhr.responseJSON?.error || "Failed to load Daily Closing report") + '</div>');
      });
  }

  // 11. ORIGINAL INVENTORY & BATCH STOCK REPORT
  function renderOriginalInventoryReport() {
    function doRender(supplierList) {
      const suppMap = {};
      (supplierList || []).forEach(s => { suppMap[String(s.id)] = s.name; });

      apiAjax("inventory/products", { type: "GET" })
        .done(function (products) {
          $("#reports_view #active_report_thead").empty();
          const $tbody = $("#reports_view #rep_inventory_tbody");
          $tbody.empty();
          let rows = "";

          (products || []).forEach(function (p) {
            const qty = Number(p.quantity);
            const minStock = Number(p.minStock || 0);
            let statusBadge = '<span class="badge-status badge-paid">Normal</span>';
            if (qty <= 0) {
              statusBadge = '<span class="badge-status" style="background:#ef4444; color:#fff; font-weight:700;">OUT OF STOCK</span>';
            } else if (qty <= minStock) {
              statusBadge = '<span class="badge-status badge-unpaid">LOW STOCK</span>';
            }
            const expiryDisplay = (p.expirationDate && String(p.expirationDate).trim())
              ? p.expirationDate
              : '<span class="text-muted">No expiry set</span>';

            let suppDisplay = "-";
            if (p.supplier) {
              const str = String(p.supplier).trim();
              if (/^\d+$/.test(str)) {
                suppDisplay = suppMap[str] || "-";
              } else {
                suppDisplay = str;
              }
            }

            const qtyText = p.pack_display ? `${DOMPurify.sanitize(p.pack_display)} <span class="text-muted" style="font-size:0.85em;">(${p.quantity})</span>` : p.quantity;
            const tr = `
              <tr>
                <td>${p.barcode || "-"}</td>
                <td class="medicine-name-cell" title="${escapeHtml(p.name)}"><strong>${DOMPurify.sanitize(p.name)}</strong></td>
                <td>${DOMPurify.sanitize(suppDisplay)}</td>
                <td>${expiryDisplay}</td>
                <td class="text-right ${qty <= minStock ? 'text-danger font-weight-bold' : ''}">${qtyText}</td>
                <td class="text-right">${formatMoney(p.price)}</td>
                <td>${statusBadge}</td>
              </tr>
            `;
            rows += tr;
          });

          if (!rows) {
            $tbody.empty();
            $("#reports_view #report_empty_state").show();
          } else {
            $("#reports_view #report_empty_state").hide();
            $tbody.html(rows);
          }
        })
        .fail(function (xhr) {
          $("#reports_view #rep_inventory_tbody").empty();
          $("#reports_view #report_summary_container").html('<div class="alert alert-danger"><i class="fa fa-exclamation-circle"></i> ' + DOMPurify.sanitize(xhr.responseJSON?.message || xhr.responseJSON?.error || "Failed to load Inventory report") + '</div>');
        });
    }

    if (cachedSuppliers && cachedSuppliers.length > 0) {
      doRender(cachedSuppliers);
    } else {
      apiAjax("suppliers/all", { type: "GET" })
        .done(function (supps) {
          cachedSuppliers = supps || [];
          doRender(cachedSuppliers);
        })
        .fail(function () {
          doRender([]);
        });
    }
  }

  // ==========================================
  // EVENT LISTENERS: REPORT CENTER
  // ==========================================

  $(document).on("click", "#reports_view #reports_menu a", function (e) {
    e.preventDefault();
    $("#reports_view #reports_menu a").removeClass("active");
    $(this).addClass("active");
    currentReportKey = $(this).data("report");
    setupExtraReportFilters(currentReportKey);
    loadActiveReport();
  });

  $(document).on("click", "#reports_view #rep_date_presets button", function () {
    const range = $(this).data("range");
    setReportRangeInputs(range);
    loadActiveReport();
  });

  $(document).on("click", "#reports_view #btn_apply_report_filter", function () {
    loadActiveReport();
  });

  $(document).on("change", "#reports_view #rep_filter_expiry_bucket, #reports_view #rep_filter_movement_days, #reports_view #rep_filter_sales_group", function () {
    loadActiveReport();
  });

  // CSV EXPORT (UTF-8 WITH BOM)
  $(document).on("click", "#reports_view #btn_export_report_csv", function () {
    const headers = [];
    const $targetThead = currentReportKey === "inventory" ? $("#reports_view #table_original_inventory thead") : $("#reports_view #active_report_thead");
    $targetThead.find("tr").last().find("th").each(function () {
      headers.push($(this).text().trim());
    });

    const rows = [];
    const $targetTbody = currentReportKey === "inventory" ? $("#reports_view #rep_inventory_tbody") : $("#reports_view #active_report_tbody");
    $targetTbody.find("tr").each(function () {
      const row = [];
      $(this).find("td").each(function () {
        row.push($(this).text().trim());
      });
      if (row.length > 0) rows.push(row);
    });

    if (rows.length === 0) {
      notiflix.Notify.warning("No data to export");
      return;
    }

    let csvContent = "\uFEFF"; // UTF-8 BOM for Excel
    csvContent += headers.map(h => `"${h.replace(/"/g, '""')}"`).join(",") + "\r\n";
    rows.forEach(r => {
      csvContent += r.map(c => `"${c.replace(/"/g, '""')}"`).join(",") + "\r\n";
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const filename = `MultiMedicos_${currentReportKey}_${getTodayKarachi()}.csv`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    notiflix.Notify.success(`Exported ${rows.length} rows to ${filename}`);
  });

  // PRINT
  $(document).on("click", "#reports_view #btn_print_report", function () {
    window.print();
  });

});
