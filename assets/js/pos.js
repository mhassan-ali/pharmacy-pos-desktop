const jsPDF = require("jspdf");
const html2canvas = require("html2canvas");
const JsBarcode = require("jsbarcode");
const macaddress = require("macaddress");
const notiflix = require("notiflix");
window.notiflix = notiflix;
const validator = require("validator");
const DOMPurify = require("dompurify");
const _ = require("lodash");
let fs = require("fs");
let path = require("path");
let moment = require("moment");
let { ipcRenderer } = require("electron");
let dotInterval = setInterval(function () {
  $(".dot").text(".");
}, 3000);
let Store = require("electron-store");
const remote = require("@electron/remote");
const app = remote.app;
let cart = [];
let index = 0;
let allUsers = [];
let allProducts = [];
let allCategories = [];
try {
  Object.defineProperty(window, 'cart', { get: () => cart, set: (v) => { cart = v; }, configurable: true });
  Object.defineProperty(window, 'allProducts', { get: () => allProducts, set: (v) => { allProducts = v; }, configurable: true });
  Object.defineProperty(window, 'allCategories', { get: () => allCategories, set: (v) => { allCategories = v; }, configurable: true });
} catch (_) {}

function getCategoryName(categoryField) {
  if (categoryField === undefined || categoryField === null || categoryField === "" || categoryField === "0" || categoryField === 0) {
    return "Uncategorized";
  }
  if (Array.isArray(allCategories) && allCategories.length > 0) {
    const byId = allCategories.find((c) => String(c._id) === String(categoryField));
    if (byId && byId.name) return byId.name;
    const byName = allCategories.find((c) => String(c.name).toLowerCase() === String(categoryField).toLowerCase());
    if (byName && byName.name) return byName.name;
  }
  return "Uncategorized";
}
let allTransactions = [];
let sold = [];
let state = [];
let sold_items = [];
let item;
let auth;
let holdOrder = 0;
let pendingSaleData = null;
let vat = 0;
let perms = null;
let deleteId = 0;
let paymentType = 0;
let receipt = "";
let totalVat = 0;
let subTotal = 0;
let method = "";
let order_index = 0;
let user_index = 0;
let product_index = 0;
let transaction_index;
const appName = process.env.APPNAME;
const appData = process.env.APPDATA;
let host = "localhost";
let port = process.env.PORT || "3210";
let img_path = path.join(appData, appName, "uploads", "/");
let api = "http://" + host + ":" + port + "/api/";
window.api = api;
let categories = [];
let holdOrderList = [];
let customerOrderList = [];
try {
  Object.defineProperty(window, 'holdOrderList', { get: () => holdOrderList, set: (v) => { holdOrderList = v; }, configurable: true });
  Object.defineProperty(window, 'allTransactions', { get: () => allTransactions, set: (v) => { allTransactions = v; }, configurable: true });
  Object.defineProperty(window, 'subTotal', { get: () => subTotal, set: (v) => { subTotal = v; }, configurable: true });
} catch (_) {}
let ownUserEdit = null;
let totalPrice = 0;
let orderTotal = 0;
let auth_error = "Incorrect username or password";
let auth_empty = "Please enter a username and password";
let holdOrderlocation = $("#renderHoldOrders");
let customerOrderLocation = $("#renderCustomerOrders");
let storage = new Store();
window.storage = storage;
let settings;
let platform = { app: "Standalone", till: 1, mac: "" };
let user = {};
let isPaymentSubmitting = false;
let posDraftTimer = null;
let draftRestored = false;

function savePosDraft() {
  clearTimeout(posDraftTimer);
  posDraftTimer = setTimeout(savePosDraftSync, 200);
}

function savePosDraftSync() {
  try {
    if (!user || !user._id) return;
    const hasCart = Array.isArray(cart) && cart.length > 0;
    const discountVal = $("#inputDiscount").val();
    const custVal = $("#customer").val();
    const paymentVal = $("#payment").val();
    const refVal = $("#refNumber").val();
    const hasDiscount = discountVal && discountVal !== "0" && discountVal !== "";
    const hasCust = custVal && custVal !== "0" && custVal !== "";
    const hasPayment = paymentVal && paymentVal !== "" && paymentVal !== "0";
    const hasRef = refVal && refVal !== "";

    if (!hasCart && !hasDiscount && !hasCust && !hasPayment && !hasRef && !holdOrder) {
      storage.delete("pos_draft");
      return;
    }
    const draft = {
      userId: user._id,
      savedAt: Date.now(),
      cart: cart.map(i => ({
        id: i.id,
        product_name: i.product_name,
        sku: i.sku,
        price: i.price,
        quantity: i.quantity,
        sale_unit: i.sale_unit || 'base',
        units_per_pack: i.units_per_pack || 1,
        base_unit: i.base_unit || null,
        units_per_strip: i.units_per_strip || null,
        units_per_box: i.units_per_box || null,
        strip_price_cents: i.strip_price_cents || null,
        box_price_cents: i.box_price_cents || null,
        base_price: i.base_price || i.price,
        category: i.category || null
      })),
      discount: discountVal || "",
      discountPercent: discountVal || "",
      customer: custVal || "0",
      holdOrder: holdOrder || 0,
      payment: paymentVal || "",
      paymentText: $("#paymentText").val() || "",
      paymentType: ($('#paymentModel .list-group-item.active').data('payment-type') || $('.list-group-item.active[data-payment-type]').data('payment-type')) || 1,
      refNumber: refVal || "",
      paymentInfo: $("#paymentInfo").val() || ""
    };
    storage.set("pos_draft", draft);
  } catch (err) {
    console.error("Error saving POS draft:", err);
  }
}

function clearPosDraft() {
  try {
    storage.delete("pos_draft");
    $("#draftNoticeAlert").remove();
  } catch (err) {
    console.error("Error clearing POS draft:", err);
  }
}

function invalidatePendingSale() {
  pendingSaleData = null;
  savePosDraft();
}

window.triggerPosDraftSave = savePosDraft;
window.savePosDraftSync = savePosDraftSync;
window.restorePosDraft = restorePosDraft;
window.triggerInvalidatePendingSale = invalidatePendingSale;
window.clearPosCart = function() {
  cart = [];
  holdOrder = 0;
  pendingSaleData = null;
  $("#inputDiscount").val("");
  $("#discountRupeeLabel").text("= " + ((settings && settings.symbol) ? validator.unescape(settings.symbol) : "PKR") + " 0.00");
  $("#customer").val("0").trigger("chosen:updated").trigger("change");
  $("#payment, #paymentText, #refNumber, #paymentInfo").val("");
  $("#change").text("");
  clearPosDraft();
  if (typeof $.fn.renderTable === "function") {
    $.fn.renderTable(cart);
  }
};
window.getPosCart = function() {
  return cart;
};

function restorePosDraftOnce() {
  if (draftRestored) return;
  draftRestored = true;
  restorePosDraft();
}

function restorePosDraft() {
  try {
    const draft = storage.get("pos_draft");
    if (!draft || !draft.userId || !user || draft.userId !== user._id) {
      if (draft && user && draft.userId !== user._id) {
        storage.delete("pos_draft");
      }
      return;
    }
    if (!Array.isArray(draft.cart) || draft.cart.length === 0) {
      return;
    }
    if (!Array.isArray(allProducts) || allProducts.length === 0) {
      return;
    }

    const validatedCart = [];
    for (const item of draft.cart) {
      const prod = allProducts.find(p => String(p._id) === String(item.id));
      if (!prod) continue;
      if (isExpired(moment(prod.expirationDate, DATE_FORMAT))) continue;

      let qty = parseInt(item.quantity) || 1;
      const sUnit = item.sale_unit || 'base';
      let mult = Number(item.units_per_pack) || 1;
      if (sUnit === 'box' && prod.units_per_box) mult = prod.units_per_box;
      else if (sUnit === 'strip' && prod.units_per_strip) mult = prod.units_per_strip;
      else mult = 1;

      let itemPrice = Number(item.price);
      if (sUnit === 'box') {
        itemPrice = prod.box_price_cents > 0 ? (prod.box_price_cents / 100) : (Number(prod.price) * (prod.units_per_box || 1));
      } else if (sUnit === 'strip') {
        itemPrice = prod.strip_price_cents > 0 ? (prod.strip_price_cents / 100) : (Number(prod.price) * (prod.units_per_strip || 1));
      } else {
        itemPrice = Number(prod.price);
      }

      if (prod.stock == 1) {
        const available = parseInt(prod.quantity) || 0;
        if (available <= 0) continue;
        const currentOtherBase = validatedCart.reduce((s, c) => String(c.id) === String(prod._id) ? s + (Number(c.quantity) * Number(c.units_per_pack || 1)) : s, 0);
        if (currentOtherBase + (qty * mult) > available) {
          const remainingBase = Math.max(0, available - currentOtherBase);
          qty = Math.floor(remainingBase / mult);
          if (qty <= 0) continue;
        }
      }

      validatedCart.push({
        id: prod._id,
        product_name: prod.name,
        sku: prod.barcode || prod.sku,
        category: prod.category,
        base_unit: prod.base_unit || item.base_unit || null,
        units_per_strip: prod.units_per_strip || item.units_per_strip || null,
        units_per_box: prod.units_per_box || item.units_per_box || null,
        strip_price_cents: prod.strip_price_cents || item.strip_price_cents || null,
        box_price_cents: prod.box_price_cents || item.box_price_cents || null,
        base_price: Number(prod.price),
        sale_unit: sUnit,
        units_per_pack: mult,
        price: itemPrice,
        quantity: qty
      });
    }

    if (validatedCart.length === 0) {
      storage.delete("pos_draft");
      return;
    }

    cart = validatedCart;
    holdOrder = draft.holdOrder || 0;

    if (draft.discountPercent !== undefined && draft.discountPercent !== null && draft.discountPercent !== "") {
      $("#inputDiscount").val(draft.discountPercent);
    } else if (draft.discount) {
      let dVal = parseFloat(draft.discount);
      if (!isNaN(dVal) && dVal > 0) {
        let draftSubtotal = validatedCart.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0);
        if (draftSubtotal > 0 && dVal > 100) {
          let pct = Math.round((dVal / draftSubtotal) * 10000) / 100;
          $("#inputDiscount").val(pct <= 100 ? pct : 100);
        } else {
          $("#inputDiscount").val(dVal);
        }
      }
    }

    if (draft.customer && draft.customer !== "0") {
      $("#customer").val(draft.customer).trigger("chosen:updated").trigger("change");
    }

    if (draft.payment) $("#payment").val(draft.payment);
    if (draft.paymentText) $("#paymentText").val(draft.paymentText);
    if (draft.refNumber) $("#refNumber").val(draft.refNumber);
    if (draft.paymentInfo) $("#paymentInfo").val(draft.paymentInfo);

    if (draft.paymentType) {
      $(".list-group-item").removeClass("active");
      if (draft.paymentType == 3) {
        $("#card").addClass("active");
        $("#cardInfo").show();
      } else if (draft.paymentType == 4) {
        $("#creditPaymentBtn").addClass("active");
        $("#cardInfo").hide();
      } else {
        $("#cash").addClass("active");
        $("#cardInfo").hide();
      }
    }

    $(this).renderTable(cart);
    if (typeof $.fn.calculateChange === "function") {
      $(this).calculateChange();
    }

    notiflix.Notify.info("Previous unsaved bill restored", {
      closeButton: true,
      timeout: 7000
    });

    if (!$("#draftNoticeAlert").length) {
      $("#cartTable").before(
        `<div id="draftNoticeAlert" class="alert alert-info alert-dismissible" style="margin-bottom:8px; padding:6px 12px; font-size:12px;">
           <i class="fa fa-history"></i> <strong>Previous unsaved bill restored.</strong>
           <a href="javascript:void(0)" id="discardRestoredDraft" class="btn btn-xs btn-danger pull-right" style="margin-top:-2px;">Discard Draft</a>
         </div>`
      );
      $("#discardRestoredDraft").off("click").on("click", function () {
        cart = [];
        holdOrder = 0;
        pendingSaleData = null;
        $("#inputDiscount").val("");
        $("#discountRupeeLabel").text("= " + ((settings && settings.symbol) ? validator.unescape(settings.symbol) : "PKR") + " 0.00");
        $("#customer").val("0").trigger("chosen:updated").trigger("change");
        $("#payment, #paymentText, #refNumber, #paymentInfo").val("");
        $("#change").text("");
        storage.delete("pos_draft");
        $("#draftNoticeAlert").remove();
        $(this).renderTable(cart);
        notiflix.Report.info("Discarded", "Restored bill draft has been discarded.", "Ok");
      });
    }
  } catch (err) {
    console.error("Error restoring POS draft:", err);
  }
}
let start = moment().startOf("month");
let end = moment().endOf("day");
let start_date = start.format("YYYY-MM-DD");
let end_date = end.format("YYYY-MM-DD");
let by_till = 0;
let by_user = 0;
let by_status = 1;
const default_item_img = path.join("assets","images","default.jpg");
const permissions = [
  "perm_products",
  "perm_categories",
  "perm_transactions",
  "perm_users",
  "perm_settings",
];
notiflix.Notify.init({
  position: "right-top",
  cssAnimationDuration: 600,
  messageMaxLength: 150,
  clickToClose: true,
  closeButton: true
});
const {
  DATE_FORMAT,
  moneyFormat,
  isExpired,
  daysToExpire,
  getStockStatus,
  checkFileExists,
  setContentSecurityPolicy,
} = require("./utils");

//set the content security policy of the app
setContentSecurityPolicy();

$(function () {
  function cb(start, end) {
    $("#reportrange span").html(
      start.format("MMMM D, YYYY") + "  -  " + end.format("MMMM D, YYYY"),
    );
  }

  $("#reportrange").daterangepicker(
    {
      startDate: start,
      endDate: end,
      autoApply: true,
      timePicker: false,
      // minDate: '',
      ranges: {
        Today: [moment().startOf("day"), moment().endOf("day")],
        Yesterday: [
          moment().subtract(1, "days").startOf("day"),
          moment().subtract(1, "days").endOf("day"),
        ],
        "Last 7 Days": [
          moment().subtract(6, "days").startOf("day"),
          moment().endOf("day"),
        ],
        "Last 30 Days": [
          moment().subtract(29, "days").startOf("day"),
          moment().endOf("day"),
        ],
        "This Month": [moment().startOf("month"), moment().endOf("day")],
        "Last Month": [
          moment().subtract(1, "month").startOf("month"),
          moment().subtract(1, "month").endOf("month"),
        ],
      },
    },
    cb,
  );

  cb(start, end);

  $("#expirationDate").daterangepicker({
    singleDatePicker: true,
    locale: {
      format: DATE_FORMAT,
    },
  });
});

//Allow only numbers in input field
$.fn.allowOnlyNumbers = function() {
  return this.on('keydown', function(e) {
  // Allow: backspace, delete, tab, escape, enter, ., ctrl/cmd+A, ctrl/cmd+C, ctrl/cmd+X, ctrl/cmd+V, end, home, left, right, down, up
    if ($.inArray(e.keyCode, [46, 8, 9, 27, 13, 110, 190]) !== -1 || 
      (e.keyCode >= 35 && e.keyCode <= 40) || 
      ((e.keyCode === 65 || e.keyCode === 67 || e.keyCode === 86 || e.keyCode === 88) && (e.ctrlKey === true || e.metaKey === true))) {
      return;
  }
  // Ensure that it is a number and stop the keypress
  if ((e.shiftKey || (e.keyCode < 48 || e.keyCode > 57)) && (e.keyCode < 96 || e.keyCode > 105)) {
    e.preventDefault();
  }
});
};
$('.number-input').allowOnlyNumbers();

//Serialize Object
$.fn.serializeObject = function () {
  var o = {};
  var a = this.serializeArray();
  $.each(a, function () {
    if (o[this.name]) {
      if (!o[this.name].push) {
        o[this.name] = [o[this.name]];
      }
      o[this.name].push(this.value || "");
    } else {
      o[this.name] = this.value || "";
    }
  });
  return o;
};

auth = storage.get("auth");
user = storage.get("user");
let setupRequired = false;
$.ajaxSetup({
  beforeSend: function (xhr) {
    const session = storage.get("auth");
    if (session && session.token) xhr.setRequestHeader("X-Access-Token", session.token);
  },
});
$(document).ajaxError(function (_event, xhr, settings) {
  if (xhr.status === 401 && !/users\/(login|setup|check|replace-default)/.test(settings.url)) {
    if (typeof savePosDraftSync === "function") savePosDraftSync();
    storage.delete("auth");
    storage.delete("user");
    ipcRenderer.send("app-reload", "");
  }
});

$("#main_app").hide();
if (auth == undefined || !auth.token) {
  storage.delete("auth");
  storage.delete("user");
  $.get(api + "users/check", function (data) {
    setupRequired = !!data.setupRequired;
    if (setupRequired) $("#account button[type='submit']").text("Create Owner Account");
  });

  authenticate();
} else {
  $("#login").hide();
  $("#main_app").show();
  platform = storage.get("settings") || platform;

  if (platform != undefined) {
    if (platform.app == "Network Point of Sale Terminal") {
      const remotePort = platform.port || port;
      api = "http://" + platform.ip + ":" + remotePort + "/api/";
      perms = true;
    }
  }

  $.get(api + "users/user/" + user._id, function (data) {
    user = data;
    $("#loggedin-user").text(user.fullname);
  });

  $.get(api + "settings/get", function (data) {
    settings = data.settings;
    window.settings = settings;
  });
  window.setTaxSettings = function(chargeTax, percentage) {
    if (settings) {
      settings.charge_tax = !!chargeTax;
      if (percentage !== undefined) settings.percentage = String(percentage);
    }
  };

  $.get(api + "users/all", function (users) {
    allUsers = [...users];
  });

  $(document).ready(function () {
    // Theme toggle handling
    function applyTheme(theme) {
      if (theme === "dark") {
        $("html, body").addClass("theme-dark");
        $("#theme-icon").removeClass("fa-moon-o").addClass("fa-sun-o");
        $("#theme-toggle").attr("title", "Switch to Light Theme");
      } else {
        $("html, body").removeClass("theme-dark");
        $("#theme-icon").removeClass("fa-sun-o").addClass("fa-moon-o");
        $("#theme-toggle").attr("title", "Switch to Dark Theme");
      }
    }

    try {
      const savedTheme = storage.get("theme") || "light";
      applyTheme(savedTheme);
    } catch (e) {}

    $(document).on("click", "#theme-toggle", function () {
      const isDark = $("body").hasClass("theme-dark") || $("html").hasClass("theme-dark");
      const nextTheme = isDark ? "light" : "dark";
      try {
        storage.set("theme", nextTheme);
      } catch (e) {}
      applyTheme(nextTheme);
    });

    //update title based on company
    let appTitle = !!settings ? `${validator.unescape(settings.store)} - ${appName}` : appName;
    $("title").text(appTitle);

    $(".loading, .splash").hide();

    loadCategories();
    loadProducts();
    loadCustomers();

    if (settings && settings.symbol && validator.unescape(settings.symbol)) {
      $("#price_curr, #payment_curr, #change_curr").text(validator.unescape(settings.symbol));
    }

    setTimeout(function () {
      if (settings == undefined && auth != undefined) {
        $("#settingsModal").modal("show");
      } else {
        vat = parseFloat(validator.unescape(settings.percentage));
        $("#taxInfo").text(settings.charge_tax ? vat : 0);
      }
    }, 1500);

    $("#settingsModal").on("hide.bs.modal", function () {
      setTimeout(function () {
        if (settings == undefined && auth != undefined) {
          $("#settingsModal").modal("show");
        }
      }, 1000);
    });

    if (0 == user.perm_products) {
      $(".p_one").hide();
    }
    if (0 == user.perm_categories) {
      $(".p_two").hide();
    }
    if (0 == user.perm_transactions) {
      $(".p_three").hide();
    }
    if (0 == user.perm_users) {
      $(".p_four").hide();
    }
    if (0 == user.perm_settings) {
      $(".p_five").hide();
    }

    function loadProducts() {
      $.get(api + "inventory/products", function (data) {
        data.forEach((item) => {
          item.price = parseFloat(item.price).toFixed(2);
        });

        allProducts = [...data];

        loadProductList();
        restorePosDraftOnce();

        let delay = 0;
        let expiredCount = 0;
        allProducts.forEach((product) => {
          let todayDate = moment();
          let expiryDate = moment(product.expirationDate, DATE_FORMAT);

          if (!isExpired(expiryDate)) {
            const diffDays = daysToExpire(expiryDate);

            if (diffDays > 0 && diffDays <= 30) {
              var days_noun = diffDays > 1 ? "days" : "day";
              notiflix.Notify.warning(
                `${product.name} has only ${diffDays} ${days_noun} left to expiry`,
              );
            }
          } else {
            expiredCount++;
          }
        });

        //Show notification if there are any expired goods.
        if(expiredCount>0)
        {
           notiflix.Notify.failure(
          `${expiredCount} ${
            expiredCount > 0 ? "products" : "product"
          } expired. Please restock!`,
        );
        }

       
        $("#parent").text("");

        data.forEach((item) => {
          if (!categories.includes(item.category)) {
            categories.push(item.category);
          }
          let item_isExpired = isExpired(item.expirationDate);
          let item_stockStatus = getStockStatus(item.quantity,item.minStock);
          if(item.img==="")
          {
            item_img = default_item_img;
          }
          else
          {
            item_img = path.join(img_path, item.img);
            item_img = checkFileExists(item_img) ? item_img : default_item_img;
          }
          

          let stockBadgeClass = "stock-badge-success";
          const hasPackBadge = item.pack_display && String(item.pack_display).trim() !== "";
          let stockText = "Stock: " + (item.stock == 1 ? (hasPackBadge ? item.pack_display : item.quantity) : "N/A");
          if (item.stock == 1) {
            if (item.quantity <= 0) {
              stockBadgeClass = "stock-badge-danger";
              stockText = "Out of Stock";
            } else if (item.quantity <= (item.minStock || 0)) {
              stockBadgeClass = "stock-badge-warning";
              stockText = hasPackBadge ? ("Low: " + item.pack_display) : ("Low: " + item.quantity);
            } else {
              stockBadgeClass = "stock-badge-success";
              stockText = hasPackBadge ? item.pack_display : ("Stock: " + item.quantity);
            }
          }

          let catName = getCategoryName(item.category);
          let item_info = `
            <div class="product-card-item box ${DOMPurify.sanitize(item.category || '')}"
                 data-product-id="${item._id}"
                 onclick="$(this).addToCart(${item._id}, ${item.quantity}, ${item.stock})"
                 title="${DOMPurify.sanitize(item.name)}">
              <div class="product-card-img-wrap">
                <img src="${item_img}" class="product-card-img" alt="${DOMPurify.sanitize(item.name)}">
              </div>
              <div class="product-card-body">
                <div class="product-card-name" id="product_name">
                  <span class="${item_isExpired ? 'text-danger' : ''}">${DOMPurify.sanitize(item.name)}</span>
                </div>
                <div class="product-card-category">
                  <span class="badge product-category-badge">${DOMPurify.sanitize(catName)}</span>
                </div>
                <div class="product-card-sku sku">${DOMPurify.sanitize(item.barcode || item._id)}</div>
                <div class="product-card-stock ${stockBadgeClass}">
                  <span class="count">${stockText}</span>
                </div>
              </div>
              <div class="product-card-price">
                ${validator.unescape((settings && settings.symbol) || "PKR")} ${moneyFormat(item.price)}
              </div>
            </div>`;
          $("#parent").append(item_info);
        });
        filterProductTiles();
      });
    }

    function filterProductTiles() {
      const query = $("#search").val().trim().toLocaleLowerCase("en");
      const selectedCategory = String($("#categories").val() || "0");
      $("#parent .box").each(function () {
        const productId = String($(this).attr("data-product-id"));
        const product = allProducts.find(item => String(item._id) === productId);
        if (!product) {
          $(this).addClass("pos-product-hidden");
          return;
        }
        const catName = getCategoryName(product.category);
        const searchText = [product.name, product.barcode, catName, product.supplier]
          .filter(value => value !== undefined && value !== null)
          .map(value => validator.unescape(String(value)).toLocaleLowerCase("en"))
          .join(" ");
        const matchesSearch = !query || searchText.includes(query);
        let matchesCategory = false;
        if (selectedCategory === "0") {
          matchesCategory = true;
        } else {
          const selectedCatObj = allCategories.find(c => String(c._id) === selectedCategory);
          if (selectedCatObj) {
            matchesCategory = String(product.category) === String(selectedCatObj._id) ||
              catName.toLowerCase() === selectedCatObj.name.toLowerCase();
          } else {
            matchesCategory = String(product.category) === selectedCategory;
          }
        }
        $(this).toggleClass("pos-product-hidden", !(matchesSearch && matchesCategory));
      });
    }

    $("#search").on("input", filterProductTiles);

    function loadCategories(callback) {
      $.get(api + "categories/all", function (data) {
        allCategories = data;
        loadCategoryList();

        const catOptions = ['<option value="0">Select Category</option>'];
        const quickCatOptions = ['<option value="">Select Category</option>'];

        allCategories.forEach((category) => {
          catOptions.push(`<option value="${category._id}">${category.name}</option>`);
          quickCatOptions.push(`<option value="${category._id}">${category.name}</option>`);
        });

        catOptions.push('<option value="__add_new__">+ Add new category...</option>');
        quickCatOptions.push('<option value="__add_new__">+ Add new category...</option>');

        const curMainCat = $("#category").val();
        $("#category").html(catOptions.join(""));
        if (curMainCat && curMainCat !== "__add_new__") $("#category").val(curMainCat);

        const curQuickCat = $("#quick_med_category").val();
        $("#quick_med_category").html(quickCatOptions.join(""));
        if (curQuickCat && curQuickCat !== "__add_new__") $("#quick_med_category").val(curQuickCat);

        $("#categories").html('<option value="0">All categories</option>' + allCategories.map(c => `<option value="${c._id}">${c.name}</option>`).join(""));

        if (allProducts && allProducts.length > 0) {
          $("#parent .product-card-item").each(function () {
            const pId = String($(this).attr("data-product-id"));
            const p = allProducts.find(item => String(item._id) === pId);
            if (p) {
              const cName = getCategoryName(p.category);
              $(this).find(".product-category-badge").text(cName);
            }
          });
        }
        filterProductTiles();
        if (typeof callback === "function") callback(allCategories);
      });
    }
    window.loadProducts = loadProducts;
    window.loadCategories = loadCategories;

    $(document).on("change", "#categories", function () {
      filterProductTiles();
    });

    function loadCustomers() {
      $.get(api + "customers/all", function (customers) {
        const currentVal = $("#customer").val();
        let selectedVal = currentVal;
        if (!selectedVal || selectedVal === "0") {
          try {
            const draft = storage.get("pos_draft");
            if (draft && draft.userId && user && draft.userId === user._id && draft.customer && draft.customer !== "0") {
              selectedVal = draft.customer;
            }
          } catch (_) {}
        }

        $("#customer").html(
          `<option value="0">Walk in customer</option>`,
        );

        customers.forEach((cust) => {
          $("#customer").append(
            $("<option>", {
              value: JSON.stringify({
                id: cust._id,
                name: cust.name,
              }),
              text: cust.name,
            }),
          );
        });

        if (selectedVal && selectedVal !== "0") {
          $("#customer").val(selectedVal);
          $("#customer").trigger("chosen:updated").trigger("change");
        } else {
          $("#customer").val("0").trigger("chosen:updated");
          $("#customer_khata_badge").hide().html("");
        }
      });
    }

    $(document).on("change", "#customer", function () {
      invalidatePendingSale();
      const val = $(this).val();
      if (!val || val === "0") {
        $("#customer_khata_badge").hide().html("");
        return;
      }
      try {
        const cust = JSON.parse(val);
        const custId = cust.id || cust._id;
        if (custId) {
          $.get(api + "ledger/customers/" + custId + "/statement", function (stmt) {
            const rec = Number(stmt.current_receivable_cents || 0);
            if (rec > 0) {
              $("#customer_khata_badge")
                .removeClass("khata-clear")
                .addClass("khata-due")
                .css({ display: "inline-block", background: "#fcf8e3", color: "#8a6d3b", border: "1px solid #faebcc", padding: "2px 8px", borderRadius: "3px", fontSize: "11px", fontWeight: "600", marginTop: "3px" })
                .html(`<i class="fa fa-book"></i> Khata Due: <strong>${validator.unescape((settings && settings.symbol) || "PKR")} ${(rec / 100).toFixed(2)}</strong>`);
            } else {
              $("#customer_khata_badge")
                .removeClass("khata-due")
                .addClass("khata-clear")
                .css({ display: "inline-block", background: "#dff0d8", color: "#3c763d", border: "1px solid #d6e9c6", padding: "2px 8px", borderRadius: "3px", fontSize: "11px", fontWeight: "600", marginTop: "3px" })
                .html(`<i class="fa fa-check-circle"></i> Khata: Clear (${validator.unescape((settings && settings.symbol) || "PKR")} 0.00)`);
            }
          });
        }
      } catch (e) {
        $("#customer_khata_badge").hide().html("");
      }
    });

    $.fn.addToCart = function (id, count, stock) {
      $.get(api + "inventory/product/" + id, function (product) {
        if (isExpired(product.expirationDate)) {
          notiflix.Report.failure(
            "Expired",
            `${product.name} is expired! Please restock.`,
            "Ok",
          );
        } else {
          if (count > 0) {
            $(this).addProductToCart(product);
          } else {
            if (stock == 1) {
              notiflix.Report.failure(
                "Out of stock!",
                `${product.name} is out of stock! Please restock.`,
                "Ok",
              );
            }
          }
        }
      });
    };

    function barcodeSearch(e) {
      e.preventDefault();
      let searchBarCodeIcon = $(".search-barcode-btn").html();
      $(".search-barcode-btn").empty();
      $(".search-barcode-btn").append(
        $("<i>", { class: "fa fa-spinner fa-spin" }),
      );

      let req = {
        skuCode: $("#skuCode").val(),
      };

      $.ajax({
        url: api + "inventory/product/sku",
        type: "POST",
        data: JSON.stringify(req),
        contentType: "application/json; charset=utf-8",
        cache: false,
        processData: false,
        success: function (product) {
          $(".search-barcode-btn").html(searchBarCodeIcon);
          const expired = isExpired(product.expirationDate);
          if (product._id != undefined && product.quantity >= 1 && !expired) {
            $(this).addProductToCart(product);
            $("#searchBarCode").get(0).reset();
            $("#basic-addon2").empty();
            $("#basic-addon2").append(
              $("<i>", { class: "glyphicon glyphicon-ok" }),
            );
          } else if (expired) {
            notiflix.Report.failure(
              "Expired!",
              `${product.name} is expired`,
              "Ok",
            );
          } else if (product.quantity < 1) {
            notiflix.Report.info(
              "Out of stock!",
              "This item is currently unavailable",
              "Ok",
            );
          } else {
            notiflix.Report.warning(
              "Not Found!",
              "<b>" + $("#skuCode").val() + "</b> is not a valid barcode!",
              "Ok",
            );

            $("#searchBarCode").get(0).reset();
            $("#basic-addon2").empty();
            $("#basic-addon2").append(
              $("<i>", { class: "glyphicon glyphicon-ok" }),
            );
          }
        },
        error: function (err) {
          if (err.status === 422) {
            $(this).showValidationError(data);
            $("#basic-addon2").append(
              $("<i>", { class: "glyphicon glyphicon-remove" }),
            );
          } else if (err.status === 404) {
            $("#basic-addon2").empty();
            $("#basic-addon2").append(
              $("<i>", { class: "glyphicon glyphicon-remove" }),
            );
          } else {
            $(this).showServerError();
            $("#basic-addon2").empty();
            $("#basic-addon2").append(
              $("<i>", { class: "glyphicon glyphicon-warning-sign" }),
            );
          }
        },
      });
    }

    $("#searchBarCode").on("submit", function (e) {
      barcodeSearch(e);
    });

    $("body").on("click", "#jq-keyboard button", function (e) {
      let pressed = $(this)[0].className.split(" ");
      if ($("#skuCode").val() != "" && pressed[2] == "enter") {
        barcodeSearch(e);
      }
    });

    function getCartBaseQuantity(productId, excludeIndex = -1) {
      let total = 0;
      cart.forEach((c, idx) => {
        if (idx !== excludeIndex && String(c.id) === String(productId)) {
          const mult = Number(c.units_per_pack) || 1;
          total += (Number(c.quantity) || 0) * mult;
        }
      });
      return total;
    }

    $.fn.addProductToCart = function (data) {
      invalidatePendingSale();
      const basePrice = parseFloat(data.price) || 0;
      let defaultUnit = 'base';
      if (data.default_sale_unit === 'box' && data.units_per_box > 1) {
        defaultUnit = 'box';
      } else if (data.default_sale_unit === 'strip' && data.units_per_strip > 1) {
        defaultUnit = 'strip';
      }

      let multiplier = 1;
      let unitPrice = basePrice;
      if (defaultUnit === 'box') {
        multiplier = Number(data.units_per_box) || 1;
        unitPrice = data.box_price_cents > 0 ? (data.box_price_cents / 100) : (basePrice * multiplier);
      } else if (defaultUnit === 'strip') {
        multiplier = Number(data.units_per_strip) || 1;
        unitPrice = data.strip_price_cents > 0 ? (data.strip_price_cents / 100) : (basePrice * multiplier);
      }

      let existingIndex = -1;
      for (let i = 0; i < cart.length; i++) {
        if (String(cart[i].id) === String(data._id) && (cart[i].sale_unit || 'base') === defaultUnit) {
          existingIndex = i;
          break;
        }
      }

      if (data.stock == 1) {
        const currentBaseInCart = getCartBaseQuantity(data._id);
        const requiredBase = 1 * multiplier;
        if (currentBaseInCart + requiredBase > (Number(data.quantity) || 0)) {
          const disp = data.pack_display || data.quantity;
          notiflix.Report.info(
            "Stock Limit Reached",
            `Only ${disp} available in stock! Cannot add more.`,
            "Ok"
          );
          return;
        }
      }

      if (existingIndex >= 0) {
        cart[existingIndex].quantity = parseInt(cart[existingIndex].quantity) + 1;
      } else {
        cart.push({
          id: data._id,
          product_name: data.name,
          sku: data.barcode || data.sku || data._id,
          category: data.category,
          base_unit: data.base_unit || null,
          units_per_strip: data.units_per_strip || null,
          units_per_box: data.units_per_box || null,
          strip_price_cents: data.strip_price_cents || null,
          box_price_cents: data.box_price_cents || null,
          base_price: basePrice,
          default_sale_unit: data.default_sale_unit || 'base',
          sale_unit: defaultUnit,
          units_per_pack: multiplier,
          price: unitPrice,
          quantity: 1
        });
      }
      $(this).renderTable(cart);
    };

    $.fn.isExist = function (data) {
      let toReturn = false;
      $.each(cart, function (index, value) {
        if (value.id == data.id) {
          $(this).setIndex(index);
          toReturn = true;
        }
      });
      return toReturn;
    };

    $.fn.setIndex = function (value) {
      index = value;
    };

    $.fn.calculateCart = function () {
      let rawSubtotal = 0;
      let grossTotal;
      let total_items = 0;
      $.each(cart, function (index, data) {
        rawSubtotal += data.quantity * data.price;
        total_items += parseInt(data.quantity);
      });
      $("#total").text(total_items);

      // Validate discount percent (0 to 100, decimals allowed)
      let rawDiscountStr = String($("#inputDiscount").val() || "").trim();
      let discountPercent = 0;
      if (rawDiscountStr !== "") {
        let parsed = parseFloat(rawDiscountStr);
        if (isNaN(parsed) || parsed < 0) {
          discountPercent = 0;
          $("#inputDiscount").val("");
        } else if (parsed > 100) {
          discountPercent = 100;
          $("#inputDiscount").val("100");
        } else {
          discountPercent = parsed;
        }
      }

      // Discount amount in rupees = subtotal * percent / 100, rounded to 2 decimals
      let discountRupees = 0;
      if (rawSubtotal > 0 && discountPercent > 0) {
        discountRupees = Number((rawSubtotal * (discountPercent / 100)).toFixed(2));
        if (discountRupees > rawSubtotal) {
          discountRupees = rawSubtotal;
        }
      }

      // Live currency symbol
      const currSymbol = (settings && settings.symbol) ? validator.unescape(settings.symbol) : "PKR";

      // Show Subtotal (raw items total before discount)
      $("#price").text(currSymbol + " " + moneyFormat(rawSubtotal.toFixed(2)));

      // Show calculated rupee discount live
      $("#discountRupeeLabel").text("= " + currSymbol + " " + moneyFormat(discountRupees.toFixed(2)));

      subTotal = rawSubtotal;
      let discountedSubtotal = rawSubtotal - discountRupees;
      if (discountedSubtotal < 0) discountedSubtotal = 0;

      if (settings && settings.charge_tax) {
        totalVat = (discountedSubtotal * vat) / 100;
        grossTotal = discountedSubtotal + totalVat;
      } else {
        grossTotal = discountedSubtotal;
      }

      orderTotal = grossTotal.toFixed(2);

      $("#gross_price").text(currSymbol + " " + moneyFormat(orderTotal));
      $("#payablePrice").val(moneyFormat(grossTotal));
      savePosDraft();
    };

    $.fn.renderTable = function (cartList) {
      $("#cartTable .card-body").empty();
      $(this).calculateCart();
      if (!cartList || cartList.length === 0) {
        $("#cartTable .card-body").html(
          `<div class="empty-cart-message">
             <i class="fa fa-shopping-cart" style="font-size:26px; color:#cbd5e1; margin-bottom:6px; display:block;"></i>
             <div style="font-size:13px; font-weight:600; color:#64748b;">Cart is empty</div>
             <small class="empty-cart-hint" style="font-size:11px;">Scan a barcode or click a product on the right</small>
           </div>`
        );
        return;
      }
      $.each(cartList, function (index, data) {
        const prod = (typeof allProducts !== 'undefined' && Array.isArray(allProducts)) ? allProducts.find(p => String(p._id) === String(data.id)) : null;
        const hasPackLevels = (data.units_per_box > 1) || (data.units_per_strip > 1);
        const baseUnitName = data.base_unit || (prod && prod.base_unit) || "Unit";
        const currentUnit = data.sale_unit || "base";

        let unitSelectorHtml = "";
        if (hasPackLevels) {
          unitSelectorHtml = `
            <select class="form-control input-sm cart-unit-select" onchange="$(this).cartUnitChange(${index}, this.value)" style="margin-top:3px; height:24px; padding:1px 5px; font-size:11px; font-weight:600;">
              <option value="base" ${currentUnit === 'base' ? 'selected' : ''}>${DOMPurify.sanitize(baseUnitName)}</option>
              ${data.units_per_strip > 1 ? `<option value="strip" ${currentUnit === 'strip' ? 'selected' : ''}>Strip (${data.units_per_strip})</option>` : ''}
              ${data.units_per_box > 1 ? `<option value="box" ${currentUnit === 'box' ? 'selected' : ''}>Box (${data.units_per_box})</option>` : ''}
            </select>
          `;
        }

        let unitLabel = currentUnit === 'box' ? 'Box' : (currentUnit === 'strip' ? 'Strip' : baseUnitName);
        let subPriceHtml = (hasPackLevels || data.base_unit)
          ? `<br><small class="text-muted" style="font-size:10px;">@ ${validator.unescape(settings.symbol)} ${moneyFormat(Number(data.price).toFixed(2))} / ${DOMPurify.sanitize(unitLabel)}</small>`
          : '';

        $("#cartTable .card-body").append(
          $("<div>", { class: "row m-t-10", style: "align-items: center;" }).append(
            $("<div>", { class: "col-md-1", text: index + 1, style: "padding-right:0;" }),
            $("<div>", { class: "col-md-4" }).append(
              $("<div>", { class: "cart-item-name", text: data.product_name, style: "font-weight:600; line-height:1.2;" }),
              $("<small>", { class: "cart-item-category text-muted", text: getCategoryName(data.category || (prod && prod.category)), style: "display:block; font-size:10px; opacity:0.85; margin-top:2px;" })
            ),
            $("<div>", { class: "col-md-3", style: "padding:0 5px;" }).append(
              $("<div>", { class: "input-group input-group-sm" }).append(
                $("<span>", { class: "input-group-btn" }).append(
                  $("<button>", {
                    class: "btn btn-light",
                    type: "button",
                    onclick: "$(this).qtDecrement(" + index + ")",
                    style: "padding: 2px 7px;"
                  }).append($("<i>", { class: "fa fa-minus" })),
                ),
                $("<input>", {
                  class: "form-control text-center",
                  type: "text",
                  readonly: "",
                  value: data.quantity,
                  min: "1",
                  style: "padding: 2px 4px; height: 26px;",
                  onInput: "$(this).qtInput(" + index + ")",
                }),
                $("<span>", { class: "input-group-btn" }).append(
                  $("<button>", {
                    class: "btn btn-light",
                    type: "button",
                    onclick: "$(this).qtIncrement(" + index + ")",
                    style: "padding: 2px 7px;"
                  }).append($("<i>", { class: "fa fa-plus" })),
                ),
              ),
              unitSelectorHtml
            ),
            $("<div>", {
              class: "col-md-3 text-right",
              style: "font-weight:600; font-size:12px; padding:0 5px;",
              html: validator.unescape(settings.symbol) + " " + moneyFormat((data.price * data.quantity).toFixed(2)) + subPriceHtml
            }),
            $("<div>", { class: "col-md-1 text-center", style: "padding:0;" }).append(
              $("<button>", {
                class: "btn btn-light btn-xs text-danger",
                type: "button",
                onclick: "$(this).deleteFromCart(" + index + ")",
                style: "padding: 3px 6px;"
              }).append($("<i>", { class: "fa fa-times" })),
            ),
          ),
        );
      });
    };

    $.fn.deleteFromCart = function (index) {
      invalidatePendingSale();
      cart.splice(index, 1);
      $(this).renderTable(cart);
    };

    $.fn.cartUnitChange = function (i, newUnit) {
      invalidatePendingSale();
      const item = cart[i];
      if (!item) return;
      const prod = (typeof allProducts !== 'undefined' && Array.isArray(allProducts)) ? allProducts.find(p => String(p._id) === String(item.id)) : null;
      const basePrice = item.base_price !== undefined ? Number(item.base_price) : (prod ? Number(prod.price) : Number(item.price));

      let newMultiplier = 1;
      let newPrice = basePrice;
      if (newUnit === 'box') {
        newMultiplier = Number(item.units_per_box || (prod ? prod.units_per_box : 1)) || 1;
        const bCents = item.box_price_cents || (prod ? prod.box_price_cents : null);
        newPrice = bCents > 0 ? (bCents / 100) : (basePrice * newMultiplier);
      } else if (newUnit === 'strip') {
        newMultiplier = Number(item.units_per_strip || (prod ? prod.units_per_strip : 1)) || 1;
        const sCents = item.strip_price_cents || (prod ? prod.strip_price_cents : null);
        newPrice = sCents > 0 ? (sCents / 100) : (basePrice * newMultiplier);
      }

      if (prod && prod.stock == 1) {
        const currentOtherBase = getCartBaseQuantity(item.id, i);
        const newBaseNeeded = parseInt(item.quantity) * newMultiplier;
        if (currentOtherBase + newBaseNeeded > (Number(prod.quantity) || 0)) {
          const disp = prod.pack_display || prod.quantity;
          notiflix.Report.info(
            "Stock Limit Reached",
            `Only ${disp} available in stock! Cannot switch unit.`,
            "Ok"
          );
          $(this).renderTable(cart);
          return;
        }
      }

      item.sale_unit = newUnit;
      item.units_per_pack = newMultiplier;
      item.price = newPrice;
      $(this).renderTable(cart);
    };

    $.fn.qtIncrement = function (i) {
      invalidatePendingSale();
      const item = cart[i];
      if (!item) return;
      const prod = (typeof allProducts !== 'undefined' && Array.isArray(allProducts)) ? allProducts.find(p => String(p._id) === String(item.id)) : null;

      if (prod && prod.stock == 1) {
        const mult = Number(item.units_per_pack) || 1;
        const currentOtherBase = getCartBaseQuantity(item.id, i);
        const newBaseNeeded = (parseInt(item.quantity) + 1) * mult;
        if (currentOtherBase + newBaseNeeded > (Number(prod.quantity) || 0)) {
          const disp = prod.pack_display || prod.quantity;
          notiflix.Report.info(
            "Stock Limit Reached",
            `Only ${disp} available in stock! Cannot add more.`,
            "Ok"
          );
          return;
        }
      }
      item.quantity = parseInt(item.quantity) + 1;
      $(this).renderTable(cart);
    };

    $.fn.qtDecrement = function (i) {
      invalidatePendingSale();
      const item = cart[i];
      if (item && item.quantity > 1) {
        item.quantity = parseInt(item.quantity) - 1;
        $(this).renderTable(cart);
      }
    };

    $.fn.qtInput = function (i) {
      invalidatePendingSale();
      const item = cart[i];
      if (!item) return;
      let val = parseInt($(this).val());
      if (isNaN(val) || val < 1) val = 1;
      const prod = (typeof allProducts !== 'undefined' && Array.isArray(allProducts)) ? allProducts.find(p => String(p._id) === String(item.id)) : null;
      if (prod && prod.stock == 1) {
        const mult = Number(item.units_per_pack) || 1;
        const currentOtherBase = getCartBaseQuantity(item.id, i);
        if (currentOtherBase + (val * mult) > (Number(prod.quantity) || 0)) {
          const disp = prod.pack_display || prod.quantity;
          notiflix.Report.info(
            "Stock Limit Reached",
            `Only ${disp} available in stock! Cannot add more.`,
            "Ok"
          );
          $(this).val(item.quantity);
          return;
        }
      }
      item.quantity = val;
      $(this).renderTable(cart);
    };

    $.fn.cancelOrder = function () {
      if (cart.length > 0) {
        const diagOptions = {
          title: "Are you sure?",
          text: "You are about to remove all items from the cart.",
          icon: "warning",
          showCancelButton: true,
          okButtonText: "Yes, clear it!",
          cancelButtonText: "Cancel",
          options: {
            // okButtonBackground: "#3085d6",
            cancelButtonBackground: "#d33",
          },
        };

        notiflix.Confirm.show(
          diagOptions.title,
          diagOptions.text,
          diagOptions.okButtonText,
          diagOptions.cancelButtonText,
          () => {
            cart = [];
            holdOrder = 0;
            pendingSaleData = null;
            $("#inputDiscount").val("");
            $("#discountRupeeLabel").text("= " + ((settings && settings.symbol) ? validator.unescape(settings.symbol) : "PKR") + " 0.00");
            clearPosDraft();
            $(this).renderTable(cart);
            notiflix.Report.success(
              "Cleared!",
              "All items have been removed.",
              "Ok",
            );
          },
          "",
          diagOptions.options,
        );
      }
    };

    $("#payButton").off("click").on("click", function () {
      if (cart.length != 0) {
        if (settings && settings.quick_billing) {
          const payableAmount = $("#payablePrice").val().replace(/,/g, "");
          $("#payment").val(payableAmount);
          $("#paymentText").val(moneyFormat(payableAmount));
          $("#payment").trigger("input");
          $(this).submitDueOrder(1);
        } else {
          $("#paymentModel").modal("toggle");
        }
      } else {
        notiflix.Report.warning("Oops!", "There is nothing to pay!", "Ok");
      }
    });

    $("#hold").on("click", function () {
      if (cart.length != 0) {
        $("#dueModal").modal("toggle");
      } else {
        notiflix.Report.warning("Oops!", "There is nothing to hold!", "Ok");
      }
    });

    function printJobComplete() {
      notiflix.Report.success("Done", "print job complete", "Ok");
    }

    function enablePaymentButtons() {
      isPaymentSubmitting = false;
      $("#confirmPayment").prop("disabled", false).removeClass("disabled").text("Confirm Payment");
      $("#payButton").prop("disabled", false).removeClass("disabled").html('<i class="fa fa-check-circle"></i> Pay');
    }

    $.fn.submitDueOrder = function (status) {
      if (status === 1) {
        if (isPaymentSubmitting) return;
        isPaymentSubmitting = true;
        $("#confirmPayment, #payButton").prop("disabled", true).addClass("disabled");
        $("#confirmPayment").text("Processing...");
        $("#payButton").html('<i class="fa fa-spinner fa-spin"></i> Processing...');
      }

      let items = "";
      let payment = 0;
      paymentType = $('#paymentModel .list-group-item.active').data('payment-type') || $('.list-group-item.active[data-payment-type]').data('payment-type');
      cart.forEach((item) => {
        const prod = (typeof allProducts !== 'undefined' && Array.isArray(allProducts)) ? allProducts.find(p => p._id == item.id) : null;
        const catName = getCategoryName(item.category || (prod && prod.category));
        const catBadge = catName && catName !== "Uncategorized" ? `<br><small style="color:#333333;font-size:8px;">[${DOMPurify.sanitize(catName)}]</small>` : "";

        let qtyText = String(item.quantity);
        const sUnit = String(item.sale_unit || 'base').toLowerCase();
        if (sUnit === 'box') {
          qtyText = `${item.quantity} Box${item.quantity > 1 ? 'es' : ''}`;
        } else if (sUnit === 'strip') {
          qtyText = `${item.quantity} Strip${item.quantity > 1 ? 's' : ''}`;
        } else if (item.base_unit) {
          qtyText = `${item.quantity} ${item.base_unit}${item.quantity > 1 && !item.base_unit.endsWith('s') ? 's' : ''}`;
        }

        const lineTotal = Number(item.price) * Number(item.quantity);
        const priceDisplay = (item.quantity > 1)
          ? `${DOMPurify.sanitize(validator.unescape(settings.symbol))} ${moneyFormat(lineTotal.toFixed(2))}<br><small style="color:#333333;font-size:8px;">(@ ${moneyFormat(Number(item.price).toFixed(2))})</small>`
          : `${DOMPurify.sanitize(validator.unescape(settings.symbol))} ${moneyFormat(lineTotal.toFixed(2))}`;

        items += `<tr><td>${DOMPurify.sanitize(item.product_name)}${catBadge}</td><td>${
          DOMPurify.sanitize(qtyText)
        } </td><td class="text-right"> ${priceDisplay} </td></tr>`;
      });

      let currentTime = (status === 1 && pendingSaleData && pendingSaleData.date) ? new Date(pendingSaleData.date) : new Date(moment());
      let rawDiscountStr = String($("#inputDiscount").val() || "").trim();
      let discountPercent = parseFloat(rawDiscountStr) || 0;
      if (discountPercent < 0) discountPercent = 0;
      if (discountPercent > 100) discountPercent = 100;
      let rawCartSubtotal = cart.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0);
      let discount = discountPercent > 0 ? Number((rawCartSubtotal * (discountPercent / 100)).toFixed(2)) : 0;
      if (discount > rawCartSubtotal) discount = rawCartSubtotal;
      let customer = JSON.parse($("#customer").val());
      let date = moment(currentTime).format("YYYY-MM-DD HH:mm:ss");
      let paymentAmount = $("#payment").val().replace(/,/g, "");
      let changeAmount = $("#change").text().replace(/,/g, "");
      let paid =
        $("#payment").val() == ""
          ? (paymentType == 4 ? "0.00" : "")
          : parseFloat(paymentAmount).toFixed(2);
      let change =
        $("#change").text() == "" ? "" : parseFloat(changeAmount).toFixed(2);
      let refNumber = $("#refNumber").val();
      let orderNumber = holdOrder;
      let type = "Cash";
      let tax_row = "";
      switch (paymentType) {
        case 1:
          type = "Cash";
          break;
        case 3:
          type = "Card";
          break;
        case 4:
          type = "Credit";
          break;
        default:
          type = "Cash";
          break;
      }

      if ((type === "Credit" || (paid !== "" && parseFloat(paid) < parseFloat(orderTotal))) && customer == 0) {
        enablePaymentButtons();
        notiflix.Report.warning(
          "Customer Required!",
          "Credit sales and partial payments require selecting a registered customer from the customer dropdown.",
          "Ok"
        );
        return;
      }

      if (paid != "") {
        payment = `<tr>
                        <td>Paid</td>
                        <td>:</td>
                        <td class="text-right">${validator.unescape(settings.symbol)} ${moneyFormat(
                          Math.abs(paid).toFixed(2),
                        )}</td>
                    </tr>
                    <tr>
                        <td>Change</td>
                        <td>:</td>
                        <td class="text-right">${validator.unescape(settings.symbol)} ${moneyFormat(
                          Math.abs(change).toFixed(2),
                        )}</td>
                    </tr>
                    <tr>
                        <td>Method</td>
                        <td>:</td>
                        <td class="text-right">${type}</td>
                    </tr>`;
      }

      if (settings.charge_tax) {
        tax_row = `<tr>
                    <td>VAT(${validator.unescape(settings.percentage)})% </td>
                    <td>:</td>
                    <td class="text-right">${validator.unescape(settings.symbol)} ${moneyFormat(
                      parseFloat(totalVat).toFixed(2),
                    )}</td>
                </tr>`;
      }

      if (status == 0) {
        if ($("#customer").val() == 0 && $("#refNumber").val() == "") {
          enablePaymentButtons();
          notiflix.Report.warning(
            "Reference Required!",
            "You either need to select a customer <br> or enter a reference!",
            "Ok",
          );
          return;
        }
      }

      $(".loading").show();

      if (holdOrder != 0) {
        orderNumber = holdOrder;
        method = "PUT";
      } else {
        orderNumber = (status === 1 && pendingSaleData && pendingSaleData._id) ? pendingSaleData._id : require('crypto').randomUUID();
        method = "POST";
      }

      logo = path.join(img_path, validator.unescape(settings.img));

      receipt = `<div style="font-size: 10px; background-color: #ffffff; color: #000000;" id="invoice-pos" class="receipt-document-root receipt-sheet receipt printable">                            
        <p style="text-align: center;">
        ${
          checkFileExists(logo)
            ? `<img style='max-width: 50px' src='${logo}' /><br>`
            : ``
        }
            <span style="font-size: 22px;">${validator.unescape(settings.store)}</span> <br>
            ${validator.unescape(settings.address_one)} <br>
            ${validator.unescape(settings.address_two)} <br>
            ${
              validator.unescape(settings.contact) != "" ? "Tel: " + validator.unescape(settings.contact) + "<br>" : ""
            } 
            ${validator.unescape(settings.tax) != "" ? "Vat No: " + validator.unescape(settings.tax) + "<br>" : ""} 
        </p>
        <hr>
        <left>
            <p>
            Order No : ${orderNumber} <br>
            Ref No : ${refNumber == "" ? orderNumber : _.escape(refNumber)} <br>
            Customer : ${
              customer == 0 ? "Walk in customer" : _.escape(customer.name)
            } <br>
            Cashier : ${user.fullname} <br>
            Date : ${date}<br>
            </p>

        </left>
        <hr>
        <table width="90%">
            <thead>
            <tr>
                <th>Item</th>
                <th>Qty</th>
                <th class="text-right">Price</th>
            </tr>
            </thead>
            <tbody>
             ${items}                
            <tr><td colspan="3"><hr></td></tr>
            <tr>                        
                <td><b>Subtotal</b></td>
                <td>:</td>
                <td class="text-right"><b>${validator.unescape(settings.symbol)}${moneyFormat(
                  subTotal.toFixed(2),
                )}</b></td>
            </tr>
            <tr>
                <td>Discount${discountPercent > 0 ? ` (${discountPercent}%)` : ""}</td>
                <td>:</td>
                <td class="text-right">${
                  discount > 0
                    ? validator.unescape(settings.symbol) + " " +
                      moneyFormat(parseFloat(discount).toFixed(2))
                    : ""
                }</td>
            </tr>
            ${tax_row}
            <tr>
                <td><h5>Total</h5></td>
                <td><h5>:</h5></td>
                <td class="text-right">
                    <h5>${validator.unescape(settings.symbol)} ${moneyFormat(
                      parseFloat(orderTotal).toFixed(2),
                    )}</h3>
                </td>
            </tr>
            ${payment == 0 ? "" : payment}
            </tbody>
            </table>
            <br>
            <hr>
            <br>
            <p style="text-align: center;">
             ${validator.unescape(settings.footer)}
             </p>
            </div>`;

      if (status == 3) {
        enablePaymentButtons();
        if (cart.length > 0) {
          try {
            const receiptPrintCss = "@page { size: auto; margin: 4mm; } body { background: #ffffff !important; color: #000000 !important; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 10px; } table { width: 90% !important; border-collapse: collapse !important; background: #ffffff !important; color: #000000 !important; } th, td { background: #ffffff !important; color: #000000 !important; padding: 2px 0 !important; } hr { border: 0 !important; border-top: 1px solid #444444 !important; margin: 6px 0 !important; } small { color: #333333 !important; }";
            printJS({ printable: receipt, type: "raw-html", style: receiptPrintCss });
          } catch (printErr) {
            console.error("Print receipt error:", printErr);
            notiflix.Report.warning("Print Error", "Could not send receipt to printer: " + (printErr.message || printErr), "Ok");
          }

          $(".loading").hide();
          return;
        } else {
          $(".loading").hide();
          return;
        }
      }

      const roundedTax = Number(parseFloat(totalVat || 0).toFixed(2));
      let data = {
        order: orderNumber,
        ref_number: refNumber,
        discount: discount,
        discount_percent: discountPercent,
        customer: customer,
        status: status,
        subtotal: parseFloat(subTotal).toFixed(2),
        tax: roundedTax,
        order_type: 1,
        items: cart,
        date: currentTime,
        payment_type: type,
        payment_info: $("#paymentInfo").val(),
        total: orderTotal,
        paid: paid,
        change: change,
        _id: orderNumber,
        till: (platform && platform.till) ? platform.till : 1,
        mac: (platform && platform.mac) ? platform.mac : "",
        user: user.fullname,
        user_id: user._id,
      };

      if (status === 1) {
        if (pendingSaleData) {
          data = pendingSaleData;
        } else {
          pendingSaleData = data;
        }
      }

      $.ajax({
        url: api + "new",
        type: method,
        data: JSON.stringify(data),
        contentType: "application/json; charset=utf-8",
        cache: false,
        processData: false,
        success: function (data) {
          enablePaymentButtons();
          pendingSaleData = null;
          holdOrder = 0;
          clearPosDraft();
          cart = [];
          $("#inputDiscount").val("");
          $("#discountRupeeLabel").text("= " + ((settings && settings.symbol) ? validator.unescape(settings.symbol) : "PKR") + " 0.00");
          $("#refNumber").val("");
          $("#change").text("");
          $("#payment,#paymentText").val("");
          try {
            receipt = DOMPurify.sanitize(receipt,{ ALLOW_UNKNOWN_PROTOCOLS: true });
            $("#viewTransaction").html("");
            $("#viewTransaction").html(receipt);
            $("#orderModal").modal("show");
          } catch (printErr) {
            console.error("Receipt display error:", printErr);
          }
          loadProducts();
          loadCustomers();
          $(".loading").hide();
          $("#dueModal").modal("hide");
          $("#paymentModel").modal("hide");
          $(this).getHoldOrders();
          $(this).getCustomerOrders();
          $(this).renderTable(cart);
        },

        error: function (xhr) {
          enablePaymentButtons();
          $(".loading").hide();
          const serverError = (xhr && xhr.responseJSON && (xhr.responseJSON.message || xhr.responseJSON.error)) || (xhr && xhr.responseText) || "Transaction could not be completed.";
          console.error("Payment failed:", serverError, xhr);
          notiflix.Report.failure(
            "Payment Failed",
            serverError,
            "Ok",
          );
        },
      });
    };

    $.get(api + "on-hold", function (data) {
      holdOrderList = data;
      holdOrderlocation.empty();
      // clearInterval(dotInterval);
      $(this).renderHoldOrders(holdOrderList, holdOrderlocation, 1);
    });

    $.fn.getHoldOrders = function () {
      $.get(api + "on-hold", function (data) {
        holdOrderList = data;
        clearInterval(dotInterval);
        holdOrderlocation.empty();
        $(this).renderHoldOrders(holdOrderList, holdOrderlocation, 1);
      });
    };

    $.fn.renderHoldOrders = function (data, renderLocation, orderType) {
      $.each(data, function (index, order) {
        $(this).calculatePrice(order);
        renderLocation.append(
          $("<div>", {
            class:
              orderType == 1 ? "col-md-3 order" : "col-md-3 customer-order",
          }).append(
            $("<a>").append(
              $("<div>", { class: "card-box order-box" }).append(
                $("<p>").append(
                  $("<b>", { text: "Ref :" }),
                  $("<span>", { text: order.ref_number, class: "ref_number" }),
                  $("<br>"),
                  $("<b>", { text: "Price :" }),
                  $("<span>", {
                    text: order.total,
                    class: "label label-info",
                    style: "font-size:14px;",
                  }),
                  $("<br>"),
                  $("<b>", { text: "Items :" }),
                  $("<span>", { text: order.items.length }),
                  $("<br>"),
                  $("<b>", { text: "Customer :" }),
                  $("<span>", {
                    text:
                      order.customer != 0
                        ? order.customer.name
                        : "Walk in customer",
                    class: "customer_name",
                  }),
                ),
                $("<button>", {
                  class: "btn btn-danger del",
                  onclick:
                    "$(this).deleteOrder(" + index + "," + orderType + ")",
                }).append($("<i>", { class: "fa fa-trash" })),

                $("<button>", {
                  class: "btn btn-default",
                  onclick:
                    "$(this).orderDetails(" + index + "," + orderType + ")",
                }).append($("<span>", { class: "fa fa-shopping-basket" })),

                $("<button>", {
                  class: "btn btn-success",
                  title: "Mark as paid",
                  onclick: "$(this).payOrder(" + index + "," + orderType + ")",
                }).append($("<span>", { class: "fa fa-money" })),
              ),
            ),
          ),
        );
      });
    };

    $.fn.calculatePrice = function (data) {
      totalPrice = 0;
      $.each(data.products, function (index, product) {
        totalPrice += product.price * product.quantity;
      });

      let vat = (totalPrice * data.vat) / 100;
      totalPrice = (totalPrice + vat - data.discount).toFixed(0);

      return totalPrice;
    };

    $.fn.orderDetails = function (index, orderType) {
      $("#refNumber").val("");

      const selectCustomerOption = (customerData) => {
        $("#customer option:selected").removeAttr("selected");

        if (customerData && customerData !== 0) {
          let selected = false;

          $("#customer option").each(function () {
            let optionValue = null;
            try {
              optionValue = JSON.parse($(this).val());
            } catch (e) {
              optionValue = null;
            }

            if (optionValue && optionValue.id == customerData.id) {
              $(this).prop("selected", true);
              selected = true;
              return false;
            }
          });

          if (!selected && customerData.name) {
            $("#customer option")
              .filter(function () {
                return $(this).text() == customerData.name;
              })
              .first()
              .prop("selected", true);

            selected = $("#customer option:selected").length > 0;
          }

          if (!selected) {
            $("#customer option")
              .filter(function () {
                return $(this).text() == "Walk in customer";
              })
              .prop("selected", true);
          }
        } else {
          $("#customer option")
            .filter(function () {
              return $(this).text() == "Walk in customer";
            })
            .prop("selected", true);
        }
      };

      if (orderType == 1) {
        $("#refNumber").val(holdOrderList[index].ref_number);
        selectCustomerOption(holdOrderList[index].customer);

        holdOrder = holdOrderList[index]._id;
        cart = [];
        $.each(holdOrderList[index].items, function (index, product) {
          const prod = (typeof allProducts !== 'undefined' && Array.isArray(allProducts)) ? allProducts.find(p => p._id == product.id) : null;
          const sUnit = product.sale_unit || 'base';
          let mult = Number(product.units_per_pack) || 1;
          if (prod) {
            if (sUnit === 'box' && prod.units_per_box) mult = prod.units_per_box;
            else if (sUnit === 'strip' && prod.units_per_strip) mult = prod.units_per_strip;
          }
          item = {
            id: product.id,
            product_name: product.product_name,
            sku: product.sku,
            category: product.category || (prod && prod.category),
            base_unit: product.base_unit || (prod && prod.base_unit) || null,
            units_per_strip: product.units_per_strip || (prod && prod.units_per_strip) || null,
            units_per_box: product.units_per_box || (prod && prod.units_per_box) || null,
            strip_price_cents: product.strip_price_cents || (prod && prod.strip_price_cents) || null,
            box_price_cents: product.box_price_cents || (prod && prod.box_price_cents) || null,
            base_price: product.base_price || (prod && Number(prod.price)) || product.price,
            sale_unit: sUnit,
            units_per_pack: mult,
            price: product.price,
            quantity: product.quantity,
          };
          cart.push(item);
        });
      } else if (orderType == 2) {
        $("#refNumber").val("");
        selectCustomerOption(customerOrderList[index].customer);

        holdOrder = customerOrderList[index]._id;
        cart = [];
        $.each(customerOrderList[index].items, function (index, product) {
          const prod = (typeof allProducts !== 'undefined' && Array.isArray(allProducts)) ? allProducts.find(p => p._id == product.id) : null;
          const sUnit = product.sale_unit || 'base';
          let mult = Number(product.units_per_pack) || 1;
          if (prod) {
            if (sUnit === 'box' && prod.units_per_box) mult = prod.units_per_box;
            else if (sUnit === 'strip' && prod.units_per_strip) mult = prod.units_per_strip;
          }
          item = {
            id: product.id,
            product_name: product.product_name,
            sku: product.sku,
            category: product.category || (prod && prod.category),
            base_unit: product.base_unit || (prod && prod.base_unit) || null,
            units_per_strip: product.units_per_strip || (prod && prod.units_per_strip) || null,
            units_per_box: product.units_per_box || (prod && prod.units_per_box) || null,
            strip_price_cents: product.strip_price_cents || (prod && prod.strip_price_cents) || null,
            box_price_cents: product.box_price_cents || (prod && prod.box_price_cents) || null,
            base_price: product.base_price || (prod && Number(prod.price)) || product.price,
            sale_unit: sUnit,
            units_per_pack: mult,
            price: product.price,
            quantity: product.quantity,
          };
          cart.push(item);
        });
      }

      const targetOrder = orderType == 1 ? holdOrderList[index] : customerOrderList[index];
      if (targetOrder && targetOrder.discount_percent !== undefined && targetOrder.discount_percent !== null && targetOrder.discount_percent !== "") {
        $("#inputDiscount").val(targetOrder.discount_percent);
      } else if (targetOrder && targetOrder.discount && Number(targetOrder.discount) > 0) {
        let orderSubtotal = (targetOrder.items || []).reduce((s, i) => s + (Number(i.price) * Number(i.quantity)), 0);
        if (orderSubtotal > 0) {
          let pct = Math.round((Number(targetOrder.discount) / orderSubtotal) * 10000) / 100;
          $("#inputDiscount").val(pct);
        } else {
          $("#inputDiscount").val("");
        }
      } else {
        $("#inputDiscount").val("");
      }
      $(this).renderTable(cart);
      $("#holdOrdersModal").modal("hide");
      $("#customerModal").modal("hide");
    };

    $.fn.payOrder = function (index, orderType) {
      $(this).orderDetails(index, orderType);
      $("#paymentModel").modal("show");
    };

    $.fn.deleteOrder = function (index, type) {
      switch (type) {
        case 1:
          deleteId = holdOrderList[index]._id;
          break;
        case 2:
          deleteId = customerOrderList[index]._id;
      }

      let data = {
        orderId: deleteId,
      };
      let diagOptions = {
        title: "Delete order?",
        text: "This will delete the order. Are you sure you want to delete!",
        icon: "warning",
        showCancelButton: true,
        okButtonColor: "#3085d6",
        cancelButtonColor: "#d33",
        okButtonText: "Yes, delete it!",
        cancelButtonText: "Cancel",
      };

      notiflix.Confirm.show(
        diagOptions.title,
        diagOptions.text,
        diagOptions.okButtonText,
        diagOptions.cancelButtonText,
        () => {
          $.ajax({
            url: api + "delete",
            type: "POST",
            data: JSON.stringify(data),
            contentType: "application/json; charset=utf-8",
            cache: false,
            success: function (data) {
              $(this).getHoldOrders();
              $(this).getCustomerOrders();

              notiflix.Report.success(
                "Deleted!",
                "You have deleted the order!",
                "Ok",
              );
            },
            error: function (data) {
              $(".loading").hide();
            },
          });
        },
      );
    };

    $.fn.getCustomerOrders = function () {
      $.get(api + "customer-orders", function (data) {
        //clearInterval(dotInterval);
        customerOrderList = data;
        customerOrderLocation.empty();
        $(this).renderHoldOrders(customerOrderList, customerOrderLocation, 2);
      });
    };

    function getSelectedCustomerData() {
      const selected = $("#customer").val();
      if (!selected || selected == 0) {
        return null;
      }

      try {
        return JSON.parse(selected);
      } catch (e) {
        return null;
      }
    }

    $("#newCustomerModal").on("click", function () {
      $("#saveCustomer").get(0).reset();
      $("#customer_id").val("");
      $("#customerModalTitle").text("New Customer");
      $("#saveCustomerBtn").val("Save Customer");
    });

    $("#editCustomerModal").on("click", function () {
      const selectedCustomer = getSelectedCustomerData();

      if (!selectedCustomer || !selectedCustomer.id) {
        notiflix.Report.warning(
          "Customer required",
          "Please select a customer to edit.",
          "Ok",
        );
        return;
      }

      $.get(api + "customers/customer/" + selectedCustomer.id, function (customer) {
        if (!customer) {
          notiflix.Report.warning(
            "Not found",
            "Could not load selected customer details.",
            "Ok",
          );
          return;
        }

        $("#customer_id").val(customer._id);
        $("#userName").val(customer.name || "");
        $("#phoneNumber").val(customer.phone || "");
        $("#emailAddress").val(customer.email || "");
        $("#userAddress").val(customer.address || "");
        $("#customerModalTitle").text("Edit Customer");
        $("#saveCustomerBtn").val("Update Customer");
        $("#newCustomer").modal("show");
      });
    });

    $("#saveCustomer").on("submit", function (e) {
      e.preventDefault();

      const customerId = $("#customer_id").val();
      let custData = {
        _id: customerId != "" ? parseInt(customerId) : Math.floor(Date.now() / 1000),
        name: $("#userName").val(),
        phone: $("#phoneNumber").val(),
        email: $("#emailAddress").val(),
        address: $("#userAddress").val(),
      };

      const requestType = customerId != "" ? "PUT" : "POST";
      const successMessage = customerId != "" ? "Customer updated successfully!" : "Customer added successfully!";

      $.ajax({
        url: api + "customers/customer",
        type: requestType,
        data: JSON.stringify(custData),
        contentType: "application/json; charset=utf-8",
        cache: false,
        processData: false,
        success: function (data) {
          $("#newCustomer").modal("hide");
          notiflix.Report.success(
            "Success",
            successMessage,
            "Ok",
          );
          loadCustomers();

          setTimeout(function () {
            $("#customer")
              .val(
                JSON.stringify({
                  id: custData._id,
                  name: custData.name,
                }),
              )
              .trigger("chosen:updated");
          }, 100);
        },
        error: function (data) {
          $("#newCustomer").modal("hide");
          notiflix.Report.failure(
            "Error",
            "Something went wrong please try again",
            "Ok",
          );
        },
      });
    });

    $("#confirmPayment").hide();

    $("#cardInfo").hide();

    $("#inputDiscount").on("input change", function () {
      invalidatePendingSale();
      $(this).calculateCart();
    });

    $("#payment").on("input", function () {
      invalidatePendingSale();
      $(this).calculateChange();
    });
    $("#confirmPayment").off("click").on("click", function () {
      var isCredit = ($('#paymentModel .list-group-item.active').data('payment-type') || $('.list-group-item.active[data-payment-type]').data('payment-type')) == 4;
      if ($("#payment").val() == "" && !isCredit) {
        notiflix.Report.warning(
          "Nope!",
          "Please enter the amount that was paid!",
          "Ok",
        );
      } else {
        $(this).submitDueOrder(1);
      }
    });

    $("#transactions").on("click", function () {
      loadTransactions();
      loadUserList();

      $("#pos_view").hide();
      $("#pointofsale").show();
      $("#transactions_view").show();
      $(this).hide();
    });

    $("#pointofsale").on("click", function () {
      $("#pos_view").show();
      $("#transactions").show();
      $("#transactions_view").hide();
      $(this).hide();
    });

    $("#viewRefOrders").on("click", function () {
      setTimeout(function () {
        $("#holdOrderInput").focus();
      }, 500);
    });

    $("#viewCustomerOrders").on("click", function () {
      setTimeout(function () {
        $("#holdCustomerOrderInput").focus();
      }, 500);
    });

    function formatStockPacks(baseQty, unitsPerBox, unitsPerStrip, baseUnitName) {
      if (baseQty == null || isNaN(baseQty)) return '0';
      const isNeg = baseQty < 0;
      let remaining = Math.abs(Math.round(baseQty));

      const boxSize = Number(unitsPerBox);
      const stripSize = Number(unitsPerStrip);
      const hasBox = Number.isSafeInteger(boxSize) && boxSize > 1;
      const hasStrip = Number.isSafeInteger(stripSize) && stripSize > 1;
      const hasPackLevel = hasBox || hasStrip;

      const rawBase = baseUnitName ? String(baseUnitName).trim() : '';
      const effectiveBase = (!hasPackLevel && (!rawBase || rawBase.toLowerCase() === 'tablet')) ? '' : rawBase;
      const hasBaseUnit = Boolean(effectiveBase);

      if (!hasBox && !hasStrip && !hasBaseUnit) {
        return String(baseQty);
      }

      function pluralUnit(count, name) {
        if (count === 1) return `${count} ${name}`;
        if (name.toLowerCase() === 'box') return `${count} Boxes`;
        if (name.toLowerCase().endsWith('s')) return `${count} ${name}`;
        return `${count} ${name}s`;
      }

      const parts = [];
      if (hasBox) {
        const boxes = Math.floor(remaining / boxSize);
        if (boxes > 0) {
          parts.push(pluralUnit(boxes, 'Box'));
          remaining %= boxSize;
        }
      }
      if (hasStrip) {
        const strips = Math.floor(remaining / stripSize);
        if (strips > 0) {
          parts.push(pluralUnit(strips, 'Strip'));
          remaining %= stripSize;
        }
      }
      if (remaining > 0 || parts.length === 0) {
        const unitLabel = effectiveBase || (hasPackLevel ? 'Tablet' : 'Unit');
        parts.push(pluralUnit(remaining, unitLabel));
      }
      const str = parts.join(' + ');
      return isNeg ? `-${str}` : str;
    }

    function escapeHtml(str) {
      if (str == null) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    // ========================================================================
    // SHARED PRODUCT PACK & UNIT FORM HELPER (Main Form & Quick Add)
    // ========================================================================
    window.ProductPackFormHelper = {
      inferSoldTypeFromCategory: function (catName) {
        if (!catName) return null;
        const name = String(catName).toLowerCase().trim();
        if (/tablet|capsule|strip|cap\b|tab\b/.test(name)) {
          return {
            type: "pack",
            baseUnit: /capsule|cap\b/.test(name) ? "Capsule" : "Tablet"
          };
        }
        if (/syrup|liquid|suspension|solution/.test(name)) {
          return { type: "single", itemUnit: "Bottle" };
        }
        if (/injection|vial|ampoule|inj\b/.test(name)) {
          return { type: "single", itemUnit: "Injection" };
        }
        if (/drop|drops|eye drop|ear drop/.test(name)) {
          return { type: "single", itemUnit: "Bottle" };
        }
        if (/cream|ointment|gel|tube/.test(name)) {
          return { type: "single", itemUnit: "Tube" };
        }
        if (/sachet/.test(name)) {
          return { type: "single", itemUnit: "Sachet" };
        }
        return null;
      },

      promptAddNewCategory: function (targetSelect, onAdded) {
        const prevVal = $(targetSelect).data("prev-val") || ($(targetSelect).attr("id") === "category" ? "0" : "");
        notiflix.Confirm.prompt(
          "New Category",
          "Enter new category name:",
          "",
          "Create Category",
          "Cancel",
          function (categoryName) {
            const name = (categoryName || "").trim();
            if (!name) {
              $(targetSelect).val(prevVal);
              return;
            }
            const existing = (allCategories || []).find(c => String(c.name).toLowerCase() === name.toLowerCase());
            if (existing) {
              $(targetSelect).val(existing._id);
              $(targetSelect).data("prev-val", existing._id);
              if (typeof onAdded === "function") onAdded(existing);
              return;
            }
            $.ajax({
              type: "POST",
              url: api + "categories/category",
              data: { name: name },
              success: function () {
                loadCategories(function (cats) {
                  const newly = (cats || allCategories || []).find(c => String(c.name).toLowerCase() === name.toLowerCase());
                  const newId = newly ? String(newly._id) : name;
                  $(targetSelect).val(newId);
                  $(targetSelect).data("prev-val", newId);
                  if (typeof onAdded === "function") onAdded(newly);
                  notiflix.Notify.success("Category '" + name + "' added.");
                });
              },
              error: function () {
                $(targetSelect).val(prevVal);
                notiflix.Report.failure("Error", "Could not create category.", "Ok");
              }
            });
          },
          function () {
            $(targetSelect).val(prevVal);
          }
        );
      },

      bindForm: function (cfg) {
        const prefix = cfg.prefix; // "quick_" or "prod_"
        const isQuick = !!cfg.isQuickAdd;

        let manualStripPrice = false;
        let manualBoxPrice = false;
        let userToggledMode = false;

        const $soldRadio = $(`input[name='${prefix}sold_type']`);
        const $singleGroup = $(`#${prefix}single_unit_group`);
        const $singleSelect = $(`#${prefix}single_unit`);
        const $singleCustomWrap = $(`#${prefix}single_unit_custom_wrap`);
        const $singleCustom = $(`#${prefix}single_unit_custom`);

        const $packSection = $(`#${prefix}pack_section`);
        const $baseSelect = $(isQuick ? "#quick_base_unit" : "#product_base_unit");
        const $baseCustomWrap = $(isQuick ? "#quick_base_unit_custom_wrap" : "#product_base_unit_custom_wrap");
        const $baseCustom = $(isQuick ? "#quick_base_unit_custom" : "#product_base_unit_custom");
        const $baseHidden = $(isQuick ? null : "#product_base_unit_hidden");

        const $uStrip = $(isQuick ? "#quick_units_per_strip" : "#product_units_per_strip");
        const $sBox = $(isQuick ? "#quick_strips_per_box" : "#product_strips_per_box");
        const $uBox = $(isQuick ? "#quick_units_per_box" : "#product_units_per_box");
        const $defSaleUnit = $(isQuick ? "#quick_default_sale_unit" : "#product_default_sale_unit");

        const $basePrice = $(isQuick ? "#quick_med_selling_price" : "#product_price");
        const $basePriceLbl = $(isQuick ? "#lbl_quick_med_selling_price" : "#label_product_price");

        const $packPricesRow = $(`#${prefix}pack_prices_row`);
        const $stripPrice = $(isQuick ? "#quick_strip_price" : "#product_strip_price");
        const $boxPrice = $(isQuick ? "#quick_box_price" : "#product_box_price");
        const $btnResetStrip = $(`#btn_${prefix}reset_strip_price`);
        const $btnResetBox = $(`#btn_${prefix}reset_box_price`);
        const $stripHint = $(isQuick ? ".quick-strip-calc-hint" : ".prod-strip-calc-hint");
        const $boxHint = $(isQuick ? ".quick-box-calc-hint" : ".prod-box-calc-hint");

        const $packPreview = $(isQuick ? "#quick_pack_preview" : "#product_pack_preview");
        const $packPreviewText = $(isQuick ? "#quick_pack_preview_text" : "#product_pack_preview_text");

        const $category = $(isQuick ? "#quick_med_category" : "#category");
        const $btnAddCat = $(`#btn_${isQuick ? 'quick' : 'main'}_add_cat`);

        function getMode() {
          return $(`input[name='${prefix}sold_type']:checked`).val() || "single";
        }

        function getSingleUnitName() {
          const val = $singleSelect.val();
          if (val === "custom") {
            return $singleCustom.val().trim() || "Item";
          }
          return val || "Item";
        }

        function getBaseUnitName() {
          const val = $baseSelect.val();
          if (val === "custom") {
            return $baseCustom.val().trim() || "Tablet";
          }
          return val || "Tablet";
        }

        function updatePriceLabels() {
          const mode = getMode();
          if (mode === "single") {
            const uName = getSingleUnitName();
            $basePriceLbl.html(`Price of 1 ${escapeHtml(uName)} (PKR) <span class="text-danger">*</span>`);
          } else {
            const uName = getBaseUnitName();
            $basePriceLbl.html(`Price of 1 ${escapeHtml(uName)} (PKR) <span class="text-danger">*</span>`);
          }
        }

        function recalculatePrices() {
          const mode = getMode();
          if (mode !== "pack") return;

          const basePrice = parseFloat($basePrice.val()) || 0;
          const uStrip = parseInt($uStrip.val()) || 0;
          const uBox = parseInt($uBox.val()) || 0;

          const autoStrip = (basePrice > 0 && uStrip > 0) ? (basePrice * uStrip) : 0;
          const autoBox = (basePrice > 0 && uBox > 0) ? (basePrice * uBox) : 0;

          $stripPrice.attr("placeholder", autoStrip > 0 ? autoStrip.toFixed(2) : "0.00");
          $boxPrice.attr("placeholder", autoBox > 0 ? autoBox.toFixed(2) : "0.00");

          if (!manualStripPrice) {
            $stripPrice.val(autoStrip > 0 ? autoStrip.toFixed(2) : "");
            $btnResetStrip.hide();
            $stripHint.hide();
          } else {
            $btnResetStrip.show();
            if (autoStrip > 0) $stripHint.text("Auto suggested: PKR " + autoStrip.toFixed(2)).show();
            else $stripHint.hide();
          }

          if (!manualBoxPrice) {
            $boxPrice.val(autoBox > 0 ? autoBox.toFixed(2) : "");
            $btnResetBox.hide();
            $boxHint.hide();
          } else {
            $btnResetBox.show();
            if (autoBox > 0) $boxHint.text("Auto suggested: PKR " + autoBox.toFixed(2)).show();
            else $boxHint.hide();
          }
        }

        function updatePreview() {
          const mode = getMode();
          updatePriceLabels();

          if (mode === "single") {
            $singleGroup.show();
            $packSection.hide();
            $packPricesRow.hide();
            $packPreview.hide();
            if (!isQuick) {
              $("#stock_unit_btn_wrap").hide();
              $("#stock_pack_preview").hide();
              if ($baseHidden) $baseHidden.val(getSingleUnitName());
            }
            return;
          }

          $singleGroup.hide();
          $packSection.show();
          $packPricesRow.show();

          const baseUnit = getBaseUnitName();
          if ($baseHidden) $baseHidden.val(baseUnit);

          const unitsStrip = parseInt($uStrip.val()) || 0;
          const unitsBox = parseInt($uBox.val()) || 0;
          const basePrice = parseFloat($basePrice.val()) || 0;

          const stripPriceVal = parseFloat($stripPrice.val());
          const effStripPrice = (!isNaN(stripPriceVal) && stripPriceVal > 0) ? stripPriceVal : (unitsStrip > 0 ? (basePrice * unitsStrip) : 0);

          const boxPriceVal = parseFloat($boxPrice.val());
          const effBoxPrice = (!isNaN(boxPriceVal) && boxPriceVal > 0) ? boxPriceVal : (unitsBox > 0 ? (basePrice * unitsBox) : 0);

          if (unitsBox > 1 || unitsStrip > 1) {
            const uName = baseUnit || "Tablet";
            let relText = "";
            if (unitsBox > 1 && unitsStrip > 1) {
              const spb = Math.floor(unitsBox / unitsStrip);
              relText = "1 Box = " + (spb > 0 ? spb + " Strips = " : "") + unitsBox + " " + (unitsBox > 1 ? uName + "s" : uName);
            } else if (unitsBox > 1) {
              relText = "1 Box = " + unitsBox + " " + (unitsBox > 1 ? uName + "s" : uName);
            } else if (unitsStrip > 1) {
              relText = "1 Strip = " + unitsStrip + " " + (unitsStrip > 1 ? uName + "s" : uName);
            }

            let sellText = "Selling: " + uName + " @ PKR " + basePrice.toFixed(2);
            if (unitsStrip > 1) sellText += " | Strip @ PKR " + effStripPrice.toFixed(2);
            if (unitsBox > 1) sellText += " | Box @ PKR " + effBoxPrice.toFixed(2);

            $packPreviewText.text(relText + ". " + sellText);
            $packPreview.show();
          } else {
            $packPreview.hide();
          }

          const curSaleUnit = $defSaleUnit.val();
          let saleOptHtml = '<option value="base">Base Unit (' + baseUnit + ')</option>';
          if (unitsStrip > 1) saleOptHtml += '<option value="strip">Strip</option>';
          if (unitsBox > 1) saleOptHtml += '<option value="box">Box</option>';
          $defSaleUnit.html(saleOptHtml).val(curSaleUnit || "base");

          if (!isQuick) {
            if (unitsBox > 1 || unitsStrip > 1) {
              $("#stock_unit_btn_wrap").show();
              const curStockUnit = $("#opening_stock_unit").val() || "base";
              let stockUnitHtml = '<option value="base">Base (' + baseUnit + ')</option>';
              if (unitsStrip > 1) stockUnitHtml += '<option value="strip">Strip</option>';
              if (unitsBox > 1) stockUnitHtml += '<option value="box">Box</option>';
              $("#opening_stock_unit").html(stockUnitHtml).val(curStockUnit);
            } else {
              $("#stock_unit_btn_wrap").hide();
            }

            if (!$("#quantity_input").prop("readonly")) {
              const stockInputVal = parseInt($("#quantity_input").val()) || 0;
              const sUnit = $("#opening_stock_unit").val();
              let mult = 1;
              if (sUnit === "box") mult = unitsBox || 1;
              else if (sUnit === "strip") mult = unitsStrip || 1;
              const baseStock = stockInputVal * mult;
              $("#quantity").val(baseStock);
              if (stockInputVal > 0 && mult > 1) {
                const uLabel = baseUnit ? (baseStock === 1 ? baseUnit : baseUnit + "s") : "base units";
                $("#stock_pack_preview").text("= " + baseStock + " " + uLabel).show();
              } else {
                $("#stock_pack_preview").hide();
              }
            }
          }
        }

        function setMode(mode, triggerInference = false) {
          $soldRadio.filter(`[value='${mode}']`).prop("checked", true);
          $soldRadio.closest(".btn").removeClass("active");
          $soldRadio.filter(`[value='${mode}']`).closest(".btn").addClass("active");
          if (!triggerInference) userToggledMode = true;
          recalculatePrices();
          updatePreview();
        }

        // Event Listeners
        $soldRadio.on("change", function () {
          setMode($(this).val(), false);
        });

        $singleSelect.on("change", function () {
          if ($(this).val() === "custom") {
            $singleCustomWrap.show();
            $singleCustom.focus();
          } else {
            $singleCustomWrap.hide();
          }
          updatePreview();
        });
        $singleCustom.on("input", updatePreview);

        $baseSelect.on("change", function () {
          if ($(this).val() === "custom") {
            $baseCustomWrap.show();
            $baseCustom.focus();
          } else {
            $baseCustomWrap.hide();
          }
          updatePreview();
        });
        $baseCustom.on("input", updatePreview);

        $uStrip.on("input", function () {
          const u = parseInt($(this).val()) || 0;
          const s = parseInt($sBox.val()) || 0;
          if (u > 0 && s > 0) {
            $uBox.val(u * s);
          } else if (u > 0) {
            const b = parseInt($uBox.val()) || 0;
            if (b > 0) $sBox.val(Math.floor(b / u) || "");
          }
          recalculatePrices();
          updatePreview();
        });

        $sBox.on("input", function () {
          const s = parseInt($(this).val()) || 0;
          const u = parseInt($uStrip.val()) || 0;
          if (u > 0 && s > 0) {
            $uBox.val(u * s);
          }
          recalculatePrices();
          updatePreview();
        });

        $uBox.on("input", function () {
          const b = parseInt($(this).val()) || 0;
          const u = parseInt($uStrip.val()) || 0;
          if (b > 0 && u > 0) {
            $sBox.val(Math.floor(b / u) || "");
          }
          recalculatePrices();
          updatePreview();
        });

        $basePrice.on("input", function () {
          recalculatePrices();
          updatePreview();
        });

        $stripPrice.on("input", function () {
          const basePrice = parseFloat($basePrice.val()) || 0;
          const uStrip = parseInt($uStrip.val()) || 0;
          const auto = (basePrice > 0 && uStrip > 0) ? (basePrice * uStrip).toFixed(2) : "";
          const typed = $(this).val().trim();
          if (typed !== "" && typed !== auto) {
            manualStripPrice = true;
            $btnResetStrip.show();
            if (auto) $stripHint.text("Auto suggested: PKR " + auto).show();
          } else {
            manualStripPrice = false;
            $btnResetStrip.hide();
            $stripHint.hide();
          }
          updatePreview();
        });

        $boxPrice.on("input", function () {
          const basePrice = parseFloat($basePrice.val()) || 0;
          const uBox = parseInt($uBox.val()) || 0;
          const auto = (basePrice > 0 && uBox > 0) ? (basePrice * uBox).toFixed(2) : "";
          const typed = $(this).val().trim();
          if (typed !== "" && typed !== auto) {
            manualBoxPrice = true;
            $btnResetBox.show();
            if (auto) $boxHint.text("Auto suggested: PKR " + auto).show();
          } else {
            manualBoxPrice = false;
            $btnResetBox.hide();
            $boxHint.hide();
          }
          updatePreview();
        });

        $btnResetStrip.on("click", function () {
          manualStripPrice = false;
          recalculatePrices();
          updatePreview();
        });

        $btnResetBox.on("click", function () {
          manualBoxPrice = false;
          recalculatePrices();
          updatePreview();
        });

        $category.on("change", function () {
          const val = $(this).val();
          if (val === "__add_new__") {
            window.ProductPackFormHelper.promptAddNewCategory($category, function (newCat) {
              if (newCat) handleCategoryChange(newCat.name);
            });
            return;
          }
          $(this).data("prev-val", val);
          const catObj = (allCategories || []).find(c => String(c._id) === String(val));
          const catName = catObj ? catObj.name : val;
          handleCategoryChange(catName);
        });

        function handleCategoryChange(catName) {
          if (userToggledMode) return;
          const inf = window.ProductPackFormHelper.inferSoldTypeFromCategory(catName);
          if (!inf) return;
          if (inf.type === "pack") {
            setMode("pack", true);
            $baseSelect.val(inf.baseUnit);
            $baseCustomWrap.hide();
            if (!$uStrip.val()) $uStrip.val("10");
            if (!$sBox.val()) $sBox.val("10");
            if (!$uBox.val()) $uBox.val("100");
          } else {
            setMode("single", true);
            $singleSelect.val(inf.itemUnit);
            $singleCustomWrap.hide();
          }
          recalculatePrices();
          updatePreview();
        }

        $btnAddCat.on("click", function () {
          window.ProductPackFormHelper.promptAddNewCategory($category, function (newCat) {
            if (newCat) handleCategoryChange(newCat.name);
          });
        });

        return {
          getMode,
          setMode,
          reset: function () {
            manualStripPrice = false;
            manualBoxPrice = false;
            userToggledMode = false;
            setMode(isQuick ? "pack" : "single", true);
            $baseSelect.val("Tablet");
            $baseCustom.val("");
            $baseCustomWrap.hide();
            $singleSelect.val("Bottle");
            $singleCustom.val("");
            $singleCustomWrap.hide();
            $uStrip.val("");
            $sBox.val("");
            $uBox.val("");
            $defSaleUnit.val("base");
            $stripPrice.val("").attr("placeholder", "0.00");
            $boxPrice.val("").attr("placeholder", "0.00");
            $btnResetStrip.hide();
            $btnResetBox.hide();
            $stripHint.hide();
            $boxHint.hide();
            $packPreview.hide();
            updatePreview();
          },
          loadForEdit: function (prod) {
            userToggledMode = true;
            manualStripPrice = false;
            manualBoxPrice = false;

            const hasPack = (prod.units_per_box > 1) || (prod.units_per_strip > 1) || (prod.base_unit && ['tablet', 'capsule'].includes(String(prod.base_unit).toLowerCase()));
            const stdUnits = ['Tablet', 'Capsule', 'Bottle', 'Injection', 'Sachet', 'Piece', 'Tube', 'Syrup', 'Drops', 'Cream'];

            if (hasPack) {
              setMode("pack", true);
              if (prod.base_unit) {
                if (['Tablet', 'Capsule', 'Sachet', 'Piece'].includes(prod.base_unit)) {
                  $baseSelect.val(prod.base_unit);
                  $baseCustomWrap.hide();
                } else {
                  $baseSelect.val("custom");
                  $baseCustom.val(prod.base_unit);
                  $baseCustomWrap.show();
                }
              } else {
                $baseSelect.val("Tablet");
                $baseCustomWrap.hide();
              }
              $uStrip.val(prod.units_per_strip || "");
              $uBox.val(prod.units_per_box || "");
              if (prod.units_per_box && prod.units_per_strip) {
                $sBox.val(Math.floor(prod.units_per_box / prod.units_per_strip));
              } else {
                $sBox.val("");
              }
              $defSaleUnit.val(prod.default_sale_unit || "base");

              const bp = parseFloat(prod.price) || 0;
              const sp = prod.strip_price_cents ? (prod.strip_price_cents / 100).toFixed(2) : "";
              const bxp = prod.box_price_cents ? (prod.box_price_cents / 100).toFixed(2) : "";

              const autoSp = (bp > 0 && prod.units_per_strip) ? (bp * prod.units_per_strip).toFixed(2) : "";
              const autoBxp = (bp > 0 && prod.units_per_box) ? (bp * prod.units_per_box).toFixed(2) : "";

              if (sp && autoSp && sp !== autoSp) manualStripPrice = true;
              if (bxp && autoBxp && bxp !== autoBxp) manualBoxPrice = true;

              $stripPrice.val(sp);
              $boxPrice.val(bxp);
            } else {
              setMode("single", true);
              if (prod.base_unit) {
                if (stdUnits.includes(prod.base_unit)) {
                  $singleSelect.val(prod.base_unit);
                  $singleCustomWrap.hide();
                } else {
                  $singleSelect.val("custom");
                  $singleCustom.val(prod.base_unit);
                  $singleCustomWrap.show();
                }
              } else {
                $singleSelect.val("Piece");
                $singleCustomWrap.hide();
              }
              $uStrip.val("");
              $sBox.val("");
              $uBox.val("");
              $stripPrice.val("");
              $boxPrice.val("");
            }

            updatePreview();
          },
          recalculatePrices,
          updatePreview
        };
      }
    };

    const mainPackForm = window.ProductPackFormHelper.bindForm({ prefix: "prod_", isQuickAdd: false });
    window.updateProductPackPreview = function () { if (mainPackForm) mainPackForm.updatePreview(); };

    $(document).on("input", "#quantity_input", function () {
      if (mainPackForm) mainPackForm.updatePreview();
    });
    $(document).on("change", "#opening_stock_unit", function () {
      if (mainPackForm) mainPackForm.updatePreview();
    });

    $("#newProductModal").on("click", function () {
      $("#saveProduct").get(0).reset();
      $("#current_img").text("");
      $("#quantity_input").val("").prop("readonly", false);
      $("#quantity").val("0");
      $("#btnEditBatches").hide();
      $("#category").val("0");
      $("#pack_edit_notice").hide();
      $("#stock_unit_btn_wrap").hide();
      $("#stock_pack_preview").hide().text("");
      if (mainPackForm) mainPackForm.reset();
    });

    $("#saveProduct").submit(function (e) {
      e.preventDefault();

      const name = $("#productName").val().trim();
      const price = parseFloat($("#product_price").val());
      if (!name || isNaN(price) || price < 0) {
        notiflix.Report.warning("Invalid Product", "Please enter a valid product name and non-negative price.", "Ok");
        return;
      }

      const mode = $("input[name='prod_sold_type']:checked").val() || "single";
      if (mode === "single") {
        const uName = $("#prod_single_unit").val() === "custom" ? $("#prod_single_unit_custom").val().trim() : $("#prod_single_unit").val();
        $("#product_base_unit_hidden").val(uName || "");
        $("#product_units_per_strip").val("");
        $("#product_strips_per_box").val("");
        $("#product_units_per_box").val("");
        $("#product_strip_price").val("");
        $("#product_box_price").val("");
        $("#product_default_sale_unit").val("base");
      } else {
        const bName = $("#product_base_unit").val() === "custom" ? $("#product_base_unit_custom").val().trim() : $("#product_base_unit").val();
        $("#product_base_unit_hidden").val(bName || "Tablet");

        const uStrip = parseInt($("#product_units_per_strip").val()) || 0;
        const uBox = parseInt($("#product_units_per_box").val()) || 0;
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

      $(this).attr("action", api + "inventory/product");
      $(this).attr("method", "POST");

      $(this).ajaxSubmit({
        contentType: "application/json",
        success: function (response) {
          $("#saveProduct").get(0).reset();
          $("#current_img").text("");

          loadProducts();
          diagOptions = {
            title: "Product Saved",
            text: "Select an option below to continue.",
            okButtonText: "Add another",
            cancelButtonText: "Close",
          };

          notiflix.Confirm.show(
            diagOptions.title,
            diagOptions.text,
            diagOptions.okButtonText,
            diagOptions.cancelButtonText,
            ()=>{},
            () => {
              $("#newProduct").modal("hide");
            },
          );
        },
        //error for product
       error: function (jqXHR,textStatus, errorThrown) {
      console.error(jqXHR.responseJSON.message);
      notiflix.Report.failure(
        jqXHR.responseJSON.error,
        jqXHR.responseJSON.message,
        "Ok",
      );
      }

      });
    });

    $("#saveCategory").submit(function (e) {
      e.preventDefault();

      if ($("#category_id").val() == "") {
        method = "POST";
      } else {
        method = "PUT";
      }

      $.ajax({
        type: method,
        url: api + "categories/category",
        data: $(this).serialize(),
        success: function (data, textStatus, jqXHR) {
          $("#saveCategory").get(0).reset();
          loadCategories();
          loadProducts();
          diagOptions = {
            title: "Category Saved",
            text: "Select an option below to continue.",
            okButtonText: "Add another",
            cancelButtonText: "Close",
          };

          notiflix.Confirm.show(
            diagOptions.title,
            diagOptions.text,
            diagOptions.okButtonText,
            diagOptions.cancelButtonText,
            ()=>{},

            () => {
                $("#newCategory").modal("hide");
            },
          );
        },
      });
    });

    $.fn.editProduct = function (index) {
      $("#Products").modal("hide");

      const prod = allProducts[index];

      // Ensure category is in dropdown, else add as legacy option
      const catExists = (allCategories || []).some(c => String(c._id) === String(prod.category) || String(c.name).toLowerCase() === String(prod.category).toLowerCase());
      if (prod.category && !catExists && prod.category !== "0") {
        if ($("#category option[value='" + prod.category + "']").length === 0) {
          $("#category").append(`<option value="${prod.category}">${prod.category}</option>`);
        }
      }
      $("#category option")
        .filter(function () {
          return $(this).val() == prod.category ||
            $(this).text().trim().toLowerCase() === String(prod.category).trim().toLowerCase();
        })
        .prop("selected", true);

      $("#productName").val(prod.name);
      $("#product_price").val(prod.price);
      $("#quantity_input").val(prod.quantity).prop("readonly", true);
      $("#quantity").val(prod.quantity);
      $("#supplier").val(prod.supplier || "");
      $("#barcode").val(prod.barcode || prod._id);
      $("#expirationDate").val(prod.expirationDate);
      $("#minStock").val(prod.minStock || 1);
      $("#product_id").val(prod._id);
      $("#img").val(prod.img);

      if (mainPackForm) {
        mainPackForm.loadForEdit(prod);
      }

      $("#pack_edit_notice").show();
      $("#stock_unit_btn_wrap").hide();

      if (prod.pack_display) {
        $("#stock_pack_preview").html(`Current stock: <strong>${prod.pack_display}</strong> (${prod.quantity} base units)`).show();
      } else {
        $("#stock_pack_preview").hide();
      }

      $("#btnEditBatches").show().off("click").on("click", function () {
        $("#newProduct").modal("hide");
        $(this).viewBatches(prod._id);
      });

      if (prod.img != "") {
        $("#imagename").hide();
        $("#current_img").html(
          `<img src="${img_path + prod.img}" alt="">`,
        );
        $("#rmv_img").show();
      } else {
        $("#imagename").show();
        $("#current_img").html("");
        $("#rmv_img").hide();
      }

      if (prod.stock == 0) {
        $("#stock").prop("checked", true);
      } else {
        $("#stock").prop("checked", false);
      }

      $("#newProduct").modal("show");
    };

    let activeBatchProduct = null;
    let activeBatches = [];

    function updateBatchCostPreview() {
      if (!activeBatchProduct) return;
      const cVal = parseFloat($("#editBatchCost").val()) || 0;
      const mult = Number($("#editBatchCostUnit option:selected").data("mult")) || 1;
      const batchId = $("#editBatchId").val();
      const batch = (activeBatches || []).find(b => String(b.id) === String(batchId));
      const initQty = batch ? (batch.initial_quantity || batch.quantity_available || 0) : 0;

      if (cVal > 0) {
        const uCost = cVal / mult;
        const totalCost = uCost * initQty;
        const uName = activeBatchProduct.base_unit || "Tablet";
        if (mult > 1) {
          $("#editBatchCostPreview").text(`Unit cost = ${cVal.toFixed(2)} / ${mult} = PKR ${uCost.toFixed(2)} per ${uName} (total cost = PKR ${moneyFormat(totalCost.toFixed(2))})`).show();
        } else {
          $("#editBatchCostPreview").text(`Total cost = PKR ${moneyFormat(totalCost.toFixed(2))}`).show();
        }
      } else {
        $("#editBatchCostPreview").hide();
      }
    }

    $(document).on("input", "#editBatchCost", updateBatchCostPreview);
    $(document).on("change", "#editBatchCostUnit", updateBatchCostPreview);

    $.fn.viewBatches = function (productId) {
      if (user && user.perm_products === 0) {
        notiflix.Report.warning("Permission Denied", "You do not have permission to manage product batches.", "Ok");
        return;
      }
      $.get(api + "inventory/batches/" + productId, function (data) {
        const prod = data.product;
        const batches = data.batches || [];
        activeBatchProduct = prod;
        activeBatches = batches;

        const packDisp = formatStockPacks(prod.quantity, prod.units_per_box, prod.units_per_strip, prod.base_unit);
        const titleText = prod.name + " (SKU: " + (prod.barcode || prod._id) + ")" + (packDisp ? (" - Stock: " + packDisp + " (" + (prod.quantity || 0) + " total)") : (" - Stock: " + (prod.quantity || 0)));
        $("#batchModalProductTitle").text(titleText);
        $("#batchModalProductId").val(productId);

        let rows = "";
        if (batches.length === 0) {
          rows = `<tr><td colspan="6" class="text-center text-muted">No batches recorded for this medicine.</td></tr>`;
        } else {
          batches.forEach((b) => {
            const isExp = isExpired(b.expiry_date);
            const formattedExp = moment(b.expiry_date, ["YYYY-MM-DD", "DD-MMM-YYYY"]).format("DD-MMM-YYYY");
            const unitCostCents = Number(b.unit_cost_cents || 0);
            const costDisplay = unitCostCents > 0
              ? ('PKR ' + (unitCostCents / 100).toFixed(2))
              : '<span class="label label-warning" title="Cost unknown - click Edit to set">Cost Unknown</span>';

            const bAvail = formatStockPacks(b.quantity_available, prod.units_per_box, prod.units_per_strip, prod.base_unit);
            const bInit = formatStockPacks(b.initial_quantity, prod.units_per_box, prod.units_per_strip, prod.base_unit);
            const availCell = (prod.units_per_box > 1 || prod.units_per_strip > 1) ? `${bAvail} <small class="text-muted">(${b.quantity_available})</small>` : b.quantity_available;
            const initCell = (prod.units_per_box > 1 || prod.units_per_strip > 1) ? `${bInit} <small class="text-muted">(${b.initial_quantity})</small>` : b.initial_quantity;

            rows += `
              <tr data-batch-id="${b.id}">
                <td><strong>${DOMPurify.sanitize(b.batch_number)}</strong></td>
                <td>
                  <span class="batch-expiry-text ${isExp ? 'text-danger' : ''}">${formattedExp}</span>
                  ${isExp ? ' <span class="label label-danger">Expired</span>' : ''}
                </td>
                <td>${availCell}</td>
                <td>${initCell}</td>
                <td>${costDisplay}</td>
                <td>${DOMPurify.sanitize(b.supplier_name || 'N/A')}</td>
                <td class="text-right">
                  <button type="button" class="btn btn-xs btn-primary btn-edit-batch"
                    data-batch-id="${b.id}"
                    data-batch-number="${DOMPurify.sanitize(b.batch_number)}"
                    data-expiry="${b.expiry_date}"
                    data-cost="${unitCostCents > 0 ? (unitCostCents / 100).toFixed(2) : ''}">
                    <i class="fa fa-edit"></i> Edit Expiry / Cost
                  </button>
                </td>
              </tr>`;
          });
        }
        $("#batchesTableBody").html(rows);
        $("#batchEditSection").hide();
        $("#batchesModal").modal("show");
      }).fail(function (err) {
        notiflix.Report.failure("Error", "Could not load batches: " + (err.responseJSON?.message || err.responseJSON?.error || err.statusText), "Ok");
      });
    };

    $(document).on("click", ".btn-edit-batch", function () {
      const batchId = $(this).data("batch-id");
      const batchNumber = $(this).data("batch-number");
      const expiry = $(this).data("expiry");
      const cost = $(this).data("cost");
      $("#editBatchId").val(batchId);
      $("#editBatchNumber").val(batchNumber);
      const formatted = moment(expiry, ["YYYY-MM-DD", "DD-MMM-YYYY"]).format("YYYY-MM-DD");
      $("#editBatchExpiry").val(formatted);

      const prod = activeBatchProduct || {};
      let costUnitOpts = `<option value="base" data-mult="1">Per Unit (${prod.base_unit || 'Unit'})</option>`;
      if (prod.units_per_strip > 1) costUnitOpts += `<option value="strip" data-mult="${prod.units_per_strip}">Per Strip (${prod.units_per_strip})</option>`;
      if (prod.units_per_box > 1) costUnitOpts += `<option value="box" data-mult="${prod.units_per_box}">Per Box (${prod.units_per_box})</option>`;
      $("#editBatchCostUnit").html(costUnitOpts).val("base");
      $("#editBatchCostPreview").hide().text("");

      if (cost && cost !== "") {
        $("#editBatchCost").val(cost).prop("disabled", true).prop("title", "Cost is locked and cannot be modified.");
        $("#editBatchCostUnit").prop("disabled", true);
      } else {
        $("#editBatchCost").val("").prop("disabled", false).prop("title", "Enter positive unit cost with up to 2 decimal places.");
        $("#editBatchCostUnit").prop("disabled", false);
      }
      $("#batchEditWarning").hide().text("");
      $("#batchEditSection").slideDown();
    });

    $("#btnCancelBatchEdit").on("click", function () {
      $("#batchEditSection").slideUp();
    });

    $("#formEditBatch").on("submit", function (e) {
      e.preventDefault();
      const batchId = $("#editBatchId").val();
      const batchNumber = $("#editBatchNumber").val().trim();
      const expiryDate = $("#editBatchExpiry").val().trim();
      const unitCostVal = $("#editBatchCost").prop("disabled") ? "" : $("#editBatchCost").val().trim();
      const productId = $("#batchModalProductId").val();

      if (!batchNumber) {
        notiflix.Notify.failure("Batch number cannot be empty");
        return;
      }
      const m = moment(expiryDate, ["YYYY-MM-DD", "DD-MMM-YYYY", "DD/MM/YYYY"], true);
      if (!m.isValid()) {
        notiflix.Notify.failure("Please enter a valid expiry date (YYYY-MM-DD or DD-MMM-YYYY)");
        return;
      }

      if (unitCostVal !== "") {
        const parsed = parseFloat(unitCostVal);
        if (isNaN(parsed) || parsed <= 0) {
          notiflix.Notify.failure("Batch unit cost must be a positive number");
          return;
        }
      }

      function doSave() {
        $("#btnSaveBatch").prop("disabled", true).text("Saving...");
        const payload = {
          batch_number: batchNumber,
          expiry_date: expiryDate,
          userId: user._id
        };
        if (unitCostVal !== "") {
          const mult = Number($("#editBatchCostUnit option:selected").data("mult")) || 1;
          if (mult > 1) {
            payload.pack_cost = unitCostVal;
            payload.pack_multiplier = mult;
            payload.unit_cost = (parseFloat(unitCostVal) / mult).toFixed(2);
          } else {
            payload.unit_cost = unitCostVal;
          }
        }
        $.ajax({
          url: api + "inventory/batch/" + batchId,
          type: "PUT",
          contentType: "application/json",
          data: JSON.stringify(payload),
          success: function (res) {
            $("#btnSaveBatch").prop("disabled", false).html('<i class="fa fa-check"></i> Save Batch');
            $("#batchEditSection").slideUp();
            notiflix.Notify.success(res.message || "Batch updated successfully");
            if (res.warning) {
              notiflix.Report.warning("Warning", res.warning, "Ok");
            }
            $(this).viewBatches(productId);
            loadProducts();
          },
          error: function (err) {
            $("#btnSaveBatch").prop("disabled", false).html('<i class="fa fa-check"></i> Save Batch');
            const msg = err.responseJSON?.message || err.responseJSON?.error || "Failed to update batch";
            notiflix.Report.failure("Error", msg, "Ok");
          }
        });
      }

      if (m.isSameOrBefore(moment(), "day")) {
        notiflix.Confirm.show(
          "Warning: Past Expiry Date",
          "The expiry date entered is in the past (" + m.format("DD-MMM-YYYY") + "). This medicine will be marked as EXPIRED and cannot be billed. Do you want to proceed?",
          "Yes, Save as Expired",
          "Cancel",
          () => doSave(),
          () => {}
        );
      } else {
        doSave();
      }
    });

    $("#userModal").on("hide.bs.modal", function () {
      $(".perms").hide();
    });

    $.fn.editUser = function (index) {
      user_index = index;

      $("#Users").modal("hide");

      $(".perms").show();

      $("#user_id").val(allUsers[index]._id);
      $("#fullname").val(allUsers[index].fullname);
      $("#username").val(validator.unescape(allUsers[index].username));
      $("#password").attr("placeholder", "New Password");
    

      for (perm of permissions) {
        var el = "#" + perm;
        if (allUsers[index][perm] == 1) {
          $(el).prop("checked", true);
        } else {
          $(el).prop("checked", false);
        }
      }

      $("#userModal").modal("show");
    };

    $.fn.editCategory = function (index) {
      $("#Categories").modal("hide");
      $("#categoryName").val(allCategories[index].name);
      $("#category_id").val(allCategories[index]._id);
      $("#newCategory").modal("show");
    };

    $.fn.deleteProduct = function (id) {
      diagOptions = {
        title: "Are you sure?",
        text: "You are about to delete this product.",
        okButtonText: "Yes, delete it!",
        cancelButtonText: "Cancel",
      };

      notiflix.Confirm.show(
        diagOptions.title,
        diagOptions.text,
        diagOptions.okButtonText,
        diagOptions.cancelButtonText,
        () => {
          $.ajax({
            url: api + "inventory/product/" + id,
            type: "DELETE",
            success: function (result) {
              loadProducts();
              notiflix.Report.success("Done!", "Product deleted", "Ok");
            },
          });
        },
      );
    };

    $.fn.deleteUser = function (id) {
      diagOptions = {
        title: "Are you sure?",
        text: "You are about to delete this user.",
        cancelButtonColor: "#d33",
        okButtonText: "Yes, delete!",
      };

      notiflix.Confirm.show(
        diagOptions.title,
        diagOptions.text,
        diagOptions.okButtonText,
        diagOptions.cancelButtonText,
        () => {
          $.ajax({
            url: api + "users/user/" + id,
            type: "DELETE",
            success: function (result) {
              loadUserList();
              notiflix.Report.success("Done!", "User deleted", "Ok");
            },
          });
        },
      );
    };

    $.fn.deleteCategory = function (id) {
      diagOptions = {
        title: "Are you sure?",
        text: "You are about to delete this category.",
        okButtonText: "Yes, delete it!",
      };

      notiflix.Confirm.show(
        diagOptions.title,
        diagOptions.text,
        diagOptions.okButtonText,
        diagOptions.cancelButtonText,
        () => {
          $.ajax({
            url: api + "categories/category/" + id,
            type: "DELETE",
            success: function (result) {
              loadCategories();
              notiflix.Report.success("Done!", "Category deleted", "Ok");
            },
          });
        },
      );
    };

    $("#productModal").on("click", function () {
      loadProductList();
    });

    $("#usersModal").on("click", function () {
      loadUserList();
    });

    $("#categoryModal").on("click", function () {
      loadCategoryList();
    });

    function loadUserList() {
      let counter = 0;
      let user_list = "";
      $("#user_list").empty();
      $("#userList").DataTable().destroy();

      $.get(api + "users/all", function (users) {
        allUsers = [...users];

        users.forEach((user, index) => {
          state = [];
          let class_name = "";

          if (user.status != "") {
            state = user.status.split("_");
            login_status = state[0];
            login_time = state[1];

            switch (login) {
              case "Logged In":
                class_name = "btn-default";

                break;
              case "Logged Out":
                class_name = "btn-light";
                break;
            }
          }

          counter++;
          user_list += `<tr>
            <td>${user.fullname}</td>
            <td>${user.username}</td>
            <td class="${class_name}">${
              state.length > 0 ? login_status : ""
            } <br><small> ${state.length > 0 ? login_time : ""}</small></td>
            <td>${
              user._id == 1
                ? '<span class="btn-group"><button class="btn btn-dark"><i class="fa fa-edit"></i></button><button class="btn btn-dark"><i class="fa fa-trash"></i></button></span>'
                : '<span class="btn-group"><button onClick="$(this).editUser(' +
                  index +
                  ')" class="btn btn-warning"><i class="fa fa-edit"></i></button><button onClick="$(this).deleteUser(' +
                  user._id +
                  ')" class="btn btn-danger"><i class="fa fa-trash"></i></button></span>'
            }</td></tr>`;

          if (counter == users.length) {
            $("#user_list").html(user_list);

            $("#userList").DataTable({
              order: [[1, "desc"]],
              autoWidth: false,
              info: true,
              JQueryUI: true,
              ordering: true,
              paging: false,
            });
          }
        });
      });
    }

    function loadProductList() {
      let products = [...allProducts];
      let product_list = "";
      let counter = 0;
      $("#product_list").empty();
      $("#productList").DataTable().destroy();

      products.forEach((product, index) => {
        counter++;

        let category = allCategories.filter(function (category) {
          return category._id == product.category;
        });

        product.stockAlert = "";
        const todayDate = moment();
        const expiryDate = moment(product.expirationDate, DATE_FORMAT);

        //show stock status indicator
        const stockStatus = getStockStatus(product.quantity,product.minStock);
          if(stockStatus<=0)
          {
          if (stockStatus === 0) {
            product.stockStatus = "No Stock";
            icon = "fa fa-exclamation-triangle";
          }
          if (stockStatus === -1) {
            product.stockStatus = "Low Stock";
            icon = "fa fa-caret-down";
          }

          product.stockAlert = `<p class="text-danger"><small><i class="${icon}"></i> ${product.stockStatus}</small></p>`;
        }
        //calculate days to expiry
        product.expiryAlert = "";
        if (!isExpired(expiryDate)) {
          const diffDays = daysToExpire(expiryDate);

          if (diffDays > 0 && diffDays <= 30) {
            var days_noun = diffDays > 1 ? "days" : "day";
            icon = "fa fa-clock-o";
            product.expiryStatus = `${diffDays} ${days_noun} left`;
            product.expiryAlert = `<p class="text-danger"><small><i class="${icon}"></i> ${product.expiryStatus}</small></p>`;
          }
        } else {
          icon = "fa fa-exclamation-triangle";
          product.expiryStatus = "Expired";
          product.expiryAlert = `<p class="text-danger"><small><i class="${icon}"></i> ${product.expiryStatus}</small></p>`;
        }

        if(product.img==="")
        {
          product_img=default_item_img;
        }
        else
        {
          product_img = img_path + product.img;
          product_img = checkFileExists(product_img)
          ? product_img
          : default_item_img;
        }
        
        //render product list
        product_list +=
          `<tr>
            <td><img id="` +
          product._id +
          `"></td>
            <td><img style="max-height: 50px; max-width: 50px; border: 1px solid #ddd;" src="${product_img}" id="product_img"></td>
            <td>${product.name}
            ${product.expiryAlert}</td>
            <td>${validator.unescape(settings.symbol)}${product.price}</td>
            <td>${product.stock == 1 ? product.quantity : "N/A"}
            ${product.stockAlert}
            </td>
            <td>${product.expirationDate}</td>
            <td>${getCategoryName(product.category)}</td>
            <td>${product.supplier || ""}</td>
            <td class="nobr"><span class="btn-group"><button onClick="$(this).editProduct(${index})" class="btn btn-warning btn-sm" title="Edit Product"><i class="fa fa-edit"></i></button><button onClick="$(this).viewBatches(${
              product._id
            })" class="btn btn-info btn-sm" title="View & Edit Batches"><i class="fa fa-calendar"></i></button><button onClick="$(this).deleteProduct(${
              product._id
            })" class="btn btn-danger btn-sm"><i class="fa fa-trash"></i></button></span></td></tr>`;

        if (counter == allProducts.length) {
          $("#product_list").html(product_list);

          products.forEach((product) => {
            let bcode = product.barcode || product._id;
            $("#" + product._id + "").JsBarcode(bcode, {
              width: 2,
              height: 25,
              fontSize: 14,
            });
          });
        }
      });

      $("#productList").DataTable({
        order: [[1, "desc"]],
        autoWidth: false,
        info: true,
        JQueryUI: true,
        ordering: true,
        paging: false,
        dom: "Bfrtip",
        buttons: [
          {
            extend: "pdfHtml5",
            className: "btn btn-light", // Custom class name
            text: " Download PDF", // Custom text
            filename: "product_list.pdf", // Default filename
          },
        ],
      });
    }

    function loadCategoryList() {
      let category_list = "";
      let counter = 0;
      $("#category_list").empty();
      $("#categoryList").DataTable().destroy();

      allCategories.forEach((category, index) => {
        counter++;

        category_list += `<tr>
     
            <td>${category.name}</td>
            <td><span class="btn-group"><button onClick="$(this).editCategory(${index})" class="btn btn-warning"><i class="fa fa-edit"></i></button><button onClick="$(this).deleteCategory(${category._id})" class="btn btn-danger"><i class="fa fa-trash"></i></button></span></td></tr>`;
      });

      if (counter == allCategories.length) {
        $("#category_list").html(category_list);
        $("#categoryList").DataTable({
          autoWidth: false,
          info: true,
          JQueryUI: true,
          ordering: true,
          paging: false,
        });
      }
    }


    $("#log-out").on("click", function () {
      const diagOptions = {
        title: "Are you sure?",
        text: "You are about to log out.",
        cancelButtonColor: "#3085d6",
        okButtonText: "Logout",
      };

      notiflix.Confirm.show(
        diagOptions.title,
        diagOptions.text,
        diagOptions.okButtonText,
        diagOptions.cancelButtonText,
        () => {
          $.get(api + "users/logout/" + user._id, function (data) {
            clearPosDraft();
            storage.delete("auth");
            storage.delete("user");
            ipcRenderer.send("app-reload", "");
          });
        },
      );
    });

    $("#settings_form").on("submit", function (e) {
      e.preventDefault();
      let formData = $(this).serializeObject();
      let mac_address;

      api = "http://" + host + ":" + port + "/api/";

      macaddress.one(function (err, mac) {
        mac_address = mac;
      });
      const appChoice = $("#app").find("option:selected").text();
    
      formData["app"] = appChoice;
      formData["mac"] = mac_address;
      formData["till"] = 1;

      // Update application field in settings form
      let $appField = $("#settings_form input[name='app']");
      let $hiddenAppField = $('<input>', {
        type: 'hidden',
        name: 'app',
        value: formData.app
    });
        $appField.length 
            ? $appField.val(formData.app) 
            : $("#settings_form").append(`<input type="hidden" name="app" value="${$hiddenAppField}" />`);


      if (formData.percentage != "" && typeof formData.percentage === 'number') {
        notiflix.Report.warning(
          "Oops!",
          "Please make sure the tax value is a number",
          "Ok",
        );
      } else {
        storage.set("settings", formData);

        $(this).attr("action", api + "settings/post");
        $(this).attr("method", "POST");

        $(this).ajaxSubmit({
          contentType: "application/json",
          success: function () {
            ipcRenderer.send("app-reload", "");
          },
          error: function (jqXHR) {
            console.error(jqXHR.responseJSON.message);
            notiflix.Report.failure(
              jqXHR.responseJSON.error,
              jqXHR.responseJSON.message,
              "Ok",
            );
      }
    });
    }
  });

    $("#net_settings_form").on("submit", function (e) {
      e.preventDefault();
      let formData = $(this).serializeObject();

      if (formData.till == 0 || formData.till == 1) {
        notiflix.Report.warning(
          "Oops!",
          "Please enter a number greater than 1.",
          "Ok",
        );
      } else {
        if (isNumeric(formData.till)) {
          formData["app"] = $("#app").find("option:selected").text();
          formData["port"] = port;
          storage.set("settings", formData);
          ipcRenderer.send("app-reload", "");
        } else {
          notiflix.Report.warning(
            "Oops!",
            "Till number must be a number!",
            "Ok",
          );
        }
      }
    });

    $("#saveUser").on("submit", function (e) {
      e.preventDefault();
      let formData = $(this).serializeObject();

      if (formData.password != formData.pass) {
        notiflix.Report.warning("Oops!", "Passwords do not match!", "Ok");
        return;
      }

        $.ajax({
          url: api + "users/post",
          type: "POST",
          data: JSON.stringify(formData),
          contentType: "application/json; charset=utf-8",
          cache: false,
          processData: false,
          success: function (data) {
            if (ownUserEdit) {
              ipcRenderer.send("app-reload", "");
            } else {
              $("#userModal").modal("hide");

              loadUserList();

              $("#Users").modal("show");
              notiflix.Report.success("Great!", "User details saved!", "Ok");
            }
          },
          error: function (jqXHR,textStatus, errorThrown) {
            notiflix.Report.failure(
              jqXHR.responseJSON.error,
              jqXHR.responseJSON.message,
              "Ok",
            );
          },
        });
    });

    $("#app").on("change", function () {
      if (
        $(this).find("option:selected").text() ==
        "Network Point of Sale Terminal"
      ) {
        $("#net_settings_form").show(500);
        $("#settings_form").hide(500);
        macaddress.one(function (err, mac) {
          $("#mac").val(mac);
        });
      } else {
        $("#net_settings_form").hide(500);
        $("#settings_form").show(500);
      }
    });

    $("#cashier").on("click", function () {
      ownUserEdit = true;

      $("#userModal").modal("show");

      $("#user_id").val(user._id);
      $("#fullname").val(user.fullname);
      $("#username").val(user.username);
      $("#password").attr("placeholder", "New Password");

      for (perm of permissions) {
        var el = "#" + perm;
        if (allUsers[index][perm] == 1) {
          $(el).prop("checked", true);
        } else {
          $(el).prop("checked", false);
        }
      }
    });

    $("#add-user").on("click", function () {
      if (platform.app != "Network Point of Sale Terminal") {
        $(".perms").show();
      }

      $("#saveUser").get(0).reset();
      $("#userModal").modal("show");
    });

    $("#settings").on("click", function () {
      if (platform.app == "Network Point of Sale Terminal") {
        $("#net_settings_form").show(500);
        $("#settings_form").hide(500);

        $("#ip").val(platform.ip);
        $("#till").val(platform.till);
        if (platform.port) {
          port = platform.port;
        }

        macaddress.one(function (err, mac) {
          $("#mac").val(mac);
        });

        $("#app option")
          .filter(function () {
            return $(this).text() == platform.app;
          })
          .prop("selected", true);
      } else {
        $("#net_settings_form").hide(500);
        $("#settings_form").show(500);

        $("#settings_id").val("1");
        $("#store").val(validator.unescape(settings.store));
        $("#address_one").val(validator.unescape(settings.address_one));
        $("#address_two").val(validator.unescape(settings.address_two));
        $("#contact").val(validator.unescape(settings.contact));
        $("#tax").val(validator.unescape(settings.tax));
        $("#symbol").val(validator.unescape(settings.symbol));
        $("#percentage").val(validator.unescape(settings.percentage));
        $("#footer").val(validator.unescape(settings.footer));
        $("#logo_img").val(validator.unescape(settings.img));
        if (settings.charge_tax) {
          $("#charge_tax").prop("checked", true);
        } else {
          $("#charge_tax").prop("checked", false);
        }

        if (settings.quick_billing) {
          $("#quick_billing").prop("checked", true);
        } else {
          $("#quick_billing").prop("checked", false);
        }
        if (validator.unescape(settings.img) != "") {
          $("#logoname").hide();
          $("#current_logo").html(
            `<img src="${img_path + validator.unescape(settings.img)}" alt="">`,
          );
          $("#rmv_logo").show();
        }

        $("#app option")
          .filter(function () {
            return $(this).text() == validator.unescape(settings.app);
          })
          .prop("selected", true);
      }
    });
 });

  $("#rmv_logo").on("click", function () {
    $("#remove_logo").val("1");
    // $("#logo_img").val('');
    $("#current_logo").hide(500);
    $(this).hide(500);
    $("#logoname").show(500);
  });

  $("#rmv_img").on("click", function () {
    $("#remove_img").val("1");
    // $("#img").val('');
    $("#current_img").hide(500);
    $(this).hide(500);
    $("#imagename").show(500);
  });
}

$.fn.print = function () {
  try {
    const receiptPrintCss = "@page { size: auto; margin: 4mm; } body { background: #ffffff !important; color: #000000 !important; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 10px; } table { width: 90% !important; border-collapse: collapse !important; background: #ffffff !important; color: #000000 !important; } th, td { background: #ffffff !important; color: #000000 !important; padding: 2px 0 !important; } hr { border: 0 !important; border-top: 1px solid #444444 !important; margin: 6px 0 !important; } small { color: #333333 !important; }";
    printJS({ printable: receipt, type: "raw-html", style: receiptPrintCss });
  } catch (printErr) {
    console.error("Print receipt error:", printErr);
    notiflix.Report.warning("Print Error", "Could not send receipt to printer: " + (printErr.message || printErr), "Ok");
  }
};

function loadTransactions() {
  const tills = [];
  const cashiers = new Map();
  let sales = 0;

  sold_items = [];
  sold = [];
  if ($.fn.DataTable.isDataTable("#transactionList")) {
    $("#transactionList").DataTable().destroy();
  }
  $("#transaction_list").html('<tr><td colspan="11" class="text-center text-muted">Loading transactions...</td></tr>');

  $.get(api + "by-date", {
    start: start_date,
    end: end_date,
    user: by_user || 0,
    status: by_status,
    till: by_till || 0,
  }).done(function (transactions) {
    allTransactions = Array.isArray(transactions) ? transactions : [];
    let transaction_list = "";

    allTransactions.forEach((trans, index) => {
      const total = Number(trans.total) || 0;
      const paid = Number(trans.paid_amount != null ? trans.paid_amount : trans.paid) || 0;
      const outstanding = Number(trans.outstanding != null ? trans.outstanding : Math.max(total - paid, 0)) || 0;
      const customerName = transactionCustomerName(trans);
      const change = Number(trans.change) || 0;
      const till = trans.till == null || trans.till === "" ? "-" : trans.till;
      const cashier = trans.user || "Unknown";

      sales += total;
      if (Array.isArray(trans.items)) sold_items.push(...trans.items);
      if (till !== "-" && !tills.some(value => String(value) === String(till))) tills.push(till);
      if (trans.user_id != null && !cashiers.has(String(trans.user_id))) {
        cashiers.set(String(trans.user_id), cashier);
      }

      transaction_list += `<tr>
        <td>${_.escape(String(trans.order || trans._id || ""))}</td>
        <td class="nobr">${moment(trans.date).format("DD-MMM-YYYY HH:mm:ss")}</td>
        <td>${_.escape(customerName)}</td>
        <td>${validator.unescape(settings.symbol) + moneyFormat(total)}</td>
        <td>${validator.unescape(settings.symbol) + moneyFormat(paid)}</td>
        <td>${validator.unescape(settings.symbol) + moneyFormat(outstanding)}</td>
        <td>${change > 0 ? validator.unescape(settings.symbol) + moneyFormat(Math.abs(change)) : "-"}</td>
        <td>${_.escape(String(trans.payment_type || "-"))}</td>
        <td>${_.escape(String(till))}</td>
        <td>${_.escape(String(cashier))}</td>
        <td><button type="button" onClick="$(this).viewTransaction(${index})" class="btn btn-info" title="View invoice"><i class="fa fa-search-plus"></i></button></td>
      </tr>`;
    });

    const result = {};
    for (const { product_name, price, quantity, id } of sold_items) {
      const name = product_name || "Unknown product";
      if (!result[name]) result[name] = { id, qty: 0, total: 0 };
      const lineQty = Number(quantity) || 0;
      const linePrice = Number(price) || 0;
      result[name].qty += lineQty;
      result[name].total += lineQty * linePrice;
    }
    Object.keys(result).forEach(name => sold.push({
      id: result[name].id,
      product: name,
      qty: result[name].qty,
      total: result[name].total,
    }));

    $("#total_sales #counter").text(validator.unescape(settings.symbol) + moneyFormat(sales));
    $("#total_transactions #counter").text(allTransactions.length);
    loadSoldProducts();

    if (by_user == 0 && by_till == 0) {
      userFilter(cashiers);
      tillFilter(tills);
    }

    $("#transaction_list").html(transaction_list || '<tr><td colspan="11" class="text-center text-muted">No transactions available within the selected criteria.</td></tr>');
    if (allTransactions.length > 0) {
      $("#transactionList").DataTable({
        order: [[1, "desc"]],
        autoWidth: false,
        info: true,
        JQueryUI: true,
        ordering: true,
        paging: true,
        dom: "Bfrtip",
        buttons: ["csv", "excel", "pdf"],
      });
    }
  }).fail(function (xhr) {
    console.error("Transaction history load failed:", xhr);
    allTransactions = [];
    $("#transaction_list").html('<tr><td colspan="11" class="text-center text-danger">Transaction history could not be loaded. Please try again.</td></tr>');
  });
}

function transactionCustomerName(transaction) {
  const customer = transaction && transaction.customer;
  if (!customer || customer === 0 || customer === "0") return "Walk in Customer";
  if (typeof customer === "object") return String(customer.name || customer.username || customer.id || customer._id || "Customer");
  return String(transaction.customer_name || customer);
}

function sortDesc(a, b) {
  if (a.qty > b.qty) {
    return -1;
  }
  if (a.qty < b.qty) {
    return 1;
  }
  return 0;
}

function loadSoldProducts() {
  sold.sort(sortDesc);

  let counter = 0;
  let sold_list = "";
  let items = 0;
  let products = 0;
  $("#product_sales").empty();

  if (sold.length === 0) {
    $("#total_items #counter").text(0);
    $("#total_products #counter").text(0);
    $("#product_sales").html('<tr><td colspan="4" class="text-center text-muted">No products sold for this selection.</td></tr>');
    return;
  }

  sold.forEach((item, index) => {
    items = items + parseInt(item.qty);
    products++;

    let product = allProducts.filter(function (selected) {
      return selected._id == item.id;
    });

    counter++;

    sold_list += `<tr>
            <td>${item.product}</td>
            <td>${item.qty}</td>
            <td>${product.length === 0 ? "-" : product[0].stock == 1 ? product[0].quantity : "N/A"}</td>
            <td>${
              validator.unescape(settings.symbol) +
              moneyFormat(parseFloat(item.total || 0).toFixed(2))
            }</td>
            </tr>`;

    if (counter == sold.length) {
      $("#total_items #counter").text(items);
      $("#total_products #counter").text(products);
      $("#product_sales").html(sold_list);
    }
  });
}

function userFilter(cashiers) {
  $("#users").empty();
  $("#users").append(`<option value="0">All</option>`);

  cashiers.forEach((fallbackName, userId) => {
    const currentUser = allUsers.find(function (usr) {
      return String(usr._id) === String(userId);
    });
    const name = currentUser ? currentUser.fullname : (fallbackName || `User ${userId}`);
    $("#users").append($("<option>", { value: userId, text: name }));
  });
}

function tillFilter(tills) {
  $("#tills").empty();
  $("#tills").append(`<option value="0">All</option>`);
  tills.forEach((till) => {
    $("#tills").append($("<option>", { value: till, text: till }));
  });
}

$.fn.viewTransaction = function (index) {
  transaction_index = index;
  const transaction = allTransactions[index];
  if (!transaction) return;

  let discount = Number(transaction.discount) || 0;
  const customer = transactionCustomerName(transaction);
  let refNumber =
    transaction.ref_number
      ? transaction.ref_number
      : transaction.order;
  let orderNumber = transaction.order;
  let paymentMethod = "";
  let tax_row = "";
  let items = "";
  let products = Array.isArray(transaction.items) ? transaction.items : [];

  products.forEach((item) => {
    const catName = item.category ? getCategoryName(item.category) : "";
    const catBadge = catName && catName !== "Uncategorized" ? `<br><small style="color:#333333;font-size:8px;">[${_.escape(catName)}]</small>` : "";

    let qtyText = String(item.quantity);
    const sUnit = String(item.sale_unit || 'base').toLowerCase();
    if (sUnit === 'box') {
      qtyText = `${item.quantity} Box${item.quantity > 1 ? 'es' : ''}`;
    } else if (sUnit === 'strip') {
      qtyText = `${item.quantity} Strip${item.quantity > 1 ? 's' : ''}`;
    } else if (item.base_unit) {
      qtyText = `${item.quantity} ${item.base_unit}${item.quantity > 1 && !item.base_unit.endsWith('s') ? 's' : ''}`;
    }

    const lineTotal = Number(item.price) * Number(item.quantity);
    const priceDisplay = (item.quantity > 1)
      ? `${validator.unescape(settings.symbol)} ${moneyFormat(lineTotal.toFixed(2))}<br><small style="color:#333333;font-size:8px;">(@ ${moneyFormat(Number(item.price).toFixed(2))})</small>`
      : `${validator.unescape(settings.symbol)} ${moneyFormat(lineTotal.toFixed(2))}`;

    items += `<tr><td>${_.escape(String(item.product_name || ""))}${catBadge}</td><td>${
      _.escape(qtyText)
    } </td><td class="text-right"> ${priceDisplay} </td></tr>`;
  });

  paymentMethod = transaction.payment_type || "-";
  const paidAmount = Number(transaction.paid_amount != null ? transaction.paid_amount : transaction.paid) || 0;
  const amountReceived = Number(transaction.paid) || 0;
  const outstanding = Number(transaction.outstanding != null ? transaction.outstanding : Math.max(Number(transaction.total) - paidAmount, 0)) || 0;
  const changeAmount = Number(transaction.change) || 0;
  const payment = `<tr>
                    <td>Paid to Date</td>
                    <td>:</td>
                    <td class="text-right">${validator.unescape(settings.symbol)} ${moneyFormat(
                      paidAmount,
                    )}</td>
                </tr>
                <tr>
                    <td>Amount Received</td>
                    <td>:</td>
                    <td class="text-right">${validator.unescape(settings.symbol)} ${moneyFormat(
                      amountReceived,
                    )}</td>
                </tr>
                <tr>
                    <td>Outstanding</td>
                    <td>:</td>
                    <td class="text-right">${validator.unescape(settings.symbol)} ${moneyFormat(
                      outstanding,
                    )}</td>
                </tr>
                <tr>
                    <td>Change</td>
                    <td>:</td>
                    <td class="text-right">${validator.unescape(settings.symbol)} ${moneyFormat(
                      Math.abs(changeAmount),
                    )}</td>
                </tr>
                <tr>
                    <td>Method</td>
                    <td>:</td>
                    <td class="text-right">${_.escape(String(paymentMethod))}</td>
                </tr>`;

  if (settings.charge_tax) {
    tax_row = `<tr>
                <td>Vat(${validator.unescape(settings.percentage)})% </td>
                <td>:</td>
                <td class="text-right">${validator.unescape(settings.symbol)}${parseFloat(
                  transaction.tax,
                ).toFixed(2)}</td>
            </tr>`;
  }

    logo = path.join(img_path, validator.unescape(settings.img));
      
      receipt = `<div style="font-size: 10px; background-color: #ffffff; color: #000000;" id="invoice-pos" class="receipt-document-root receipt-sheet receipt printable">                            
        <p style="text-align: center;">
        ${
          checkFileExists(logo)
            ? `<img style='max-width: 50px' src='${logo}' /><br>`
            : ``
        }
            <span style="font-size: 22px;">${validator.unescape(settings.store)}</span> <br>
            ${validator.unescape(settings.address_one)} <br>
            ${validator.unescape(settings.address_two)} <br>
            ${
              validator.unescape(settings.contact) != "" ? "Tel: " + validator.unescape(settings.contact) + "<br>" : ""
            } 
            ${validator.unescape(settings.tax) != "" ? "Vat No: " + validator.unescape(settings.tax) + "<br>" : ""} 
    </p>
    <hr>
    <left>
        <p>
        Invoice : ${orderNumber} <br>
        Ref No : ${refNumber} <br>
        Customer : ${_.escape(customer)} <br>
        Cashier : ${_.escape(String(transaction.user || "Unknown"))} <br>
        Date : ${moment(transaction.date).format(
          "DD MMM YYYY HH:mm:ss",
        )}<br>
        </p>

    </left>
    <hr>
    <table width="90%">
        <thead>
        <tr>
            <th>Item</th>
            <th>Qty</th>
            <th class="text-right">Price</th>
        </tr>
        </thead>
        <tbody>
        ${items}                
        <tr><td colspan="3"><hr></td></tr>
        <tr>                        
            <td><b>Subtotal</b></td>
            <td>:</td>
            <td class="text-right"><b>${validator.unescape(settings.symbol)}${moneyFormat(
              transaction.subtotal,
            )}</b></td>
        </tr>
        <tr>
            <td>Discount${(transaction.discount_percent !== undefined && transaction.discount_percent !== null && Number(transaction.discount_percent) > 0) ? ` (${transaction.discount_percent}%)` : ""}</td>
            <td>:</td>
            <td class="text-right">${
              discount > 0
                ? validator.unescape(settings.symbol) + " " +
                  moneyFormat(
                    discount,
                  )
                : ""
            }</td>
        </tr>
        
        ${tax_row}
    
        <tr>
            <td><h5>Total</h5></td>
            <td><h5>:</h5></td>
            <td class="text-right">
                <h5>${validator.unescape(settings.symbol)}${moneyFormat(
                  transaction.total,
                )}</h5>
            </td>
        </tr>
        ${payment}
        </tbody>
        </table>
        <br>
        <hr>
        <br>
        <p style="text-align: center;">
         ${validator.unescape(settings.footer)}
         </p>
        </div>`;

        //prevent DOM XSS; allow windows paths in img src
        receipt = DOMPurify.sanitize(receipt,{ ALLOW_UNKNOWN_PROTOCOLS: true });

  $("#viewTransaction").html("");
  $("#viewTransaction").html(receipt);

  $("#orderModal").modal("show");
};

$("#status").on("change", function () {
  by_status = $(this).find("option:selected").val();
  loadTransactions();
});

$("#tills").on("change", function () {
  by_till = $(this).find("option:selected").val();
  loadTransactions();
});

$("#users").on("change", function () {
  by_user = $(this).find("option:selected").val();
  loadTransactions();
});

$("#reportrange").on("apply.daterangepicker", function (ev, picker) {
  start = picker.startDate.clone().startOf("day");
  end = picker.endDate.clone().endOf("day");
  start_date = start.format("YYYY-MM-DD");
  end_date = end.format("YYYY-MM-DD");

  loadTransactions();
});

function authenticate() {
  $(".loading, .splash").hide();
  $("body").attr("class", "login-page");
  $("#login").show();
}

function completeLogin(data) {
  storage.set("auth", { auth: true, token: data.token });
  storage.set("user", data);
  ipcRenderer.send("app-reload", "");
  $("#login").hide();
}

$("body").on("submit", "#account", function (e) {
  e.preventDefault();
  let formData = $(this).serializeObject();

  if (formData.username == "" || formData.password == "") {
    notiflix.Report.warning("Incomplete form!", auth_empty, "Ok");
  } else {
    $.ajax({
      url: api + (setupRequired ? "users/setup" : "users/login"),
      type: "POST",
      data: JSON.stringify(formData),
      contentType: "application/json; charset=utf-8",
      cache: false,
      processData: false,
      success: function (data) {
        if (data.auth === true) {
          completeLogin(data);
        } else if (data.changeRequired) {
          notiflix.Confirm.prompt(
            "Replace default password",
            "Enter a new password of at least 12 characters.",
            "", "Continue", "Cancel",
            function (newPassword) {
              if (newPassword.length < 12) {
                notiflix.Report.warning("Password too short", "Use at least 12 characters.", "Ok");
                return;
              }
              setTimeout(function () {
                notiflix.Confirm.ask(
                  "Confirm new password", "Enter the same password again.",
                  newPassword, "Save", "Cancel",
                  function () {
                    $.ajax({
                      url: api + "users/replace-default",
                      type: "POST",
                      data: JSON.stringify({ oldPassword: formData.password, newPassword }),
                      contentType: "application/json; charset=utf-8",
                      success: completeLogin,
                      error: function (xhr) { notiflix.Report.failure("Password change failed", xhr.responseJSON?.error || "Please try again.", "Ok"); },
                    });
                  },
                );
                document.getElementById("NXConfirmValidationInput").type = "password";
              }, 350);
            },
          );
          document.getElementById("NXConfirmValidationInput").type = "password";
        } else {
          notiflix.Report.warning("Oops!", auth_error, "Ok");
        }
      },
      error: function (data) {
        notiflix.Report.failure("Sign in failed", data.responseJSON?.error || "Please try again.", "Ok");
      },
    });
  }
});

$("#quit").on("click", function () {
  const diagOptions = {
    title: "Are you sure?",
    text: "You are about to close the application.",
    icon: "warning",
    okButtonText: "Close Application",
    cancelButtonText: "Cancel"
  };

  notiflix.Confirm.show(
    diagOptions.title,
    diagOptions.text,
    diagOptions.okButtonText,
    diagOptions.cancelButtonText,
    () => {
      ipcRenderer.send("app-quit", "");
    },
  );
});

ipcRenderer.on("click-element", (event, elementId) => {
  document.getElementById(elementId).click();
});

try {
  require("./enterprise.js");
} catch (e) {
  console.error("Enterprise module initialization error:", e);
}
