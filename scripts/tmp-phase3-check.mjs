import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

async function tokenFor(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) throw verifyError;
  return verified.session.access_token;
}

const managerToken = await tokenFor("grace-wanjiru@pedigree.local");
const cashierToken = await tokenFor("brian-otieno@pedigree.local");

async function rest(path, token, init = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, body };
}

const anonProducts = await rest("products?select=id,name,base_price,is_website_published&order=name", anonKey);
console.log("anon products", anonProducts.status, anonProducts.body);

const managerProducts = await rest("products?select=id,name,base_price,is_website_published&order=name", managerToken);
console.log("manager products", managerProducts.status, managerProducts.body);

const update = await rest("rpc/pos_manager_update_product", managerToken, {
  method: "POST",
  body: JSON.stringify({
    p_product_id: "c0a80101-0000-4000-8000-000000000001",
    p_name: "Karura Tote",
    p_description: "A structured everyday tote in full-grain leather.",
    p_category: "bag",
    p_base_price: 13000,
    p_discount_percent: 0,
    p_barcode: "PED-KARURA-001",
    p_active: true,
    p_is_website_published: true,
    p_colors: [
      {
        id: "c0a80201-0000-4000-8000-000000000001",
        name: "Tan",
        hex: "#8b4513",
        images: [{ angle: "front", image_url: "https://example.com/karura-tan-front.jpg" }],
      },
      {
        id: "c0a80201-0000-4000-8000-000000000002",
        name: "Black",
        hex: "#1f1f1f",
        images: [],
      },
    ],
  }),
});
console.log("manager update", update.status, update.body);

const anonAfter = await rest("products?select=id,name,base_price,is_website_published&id=eq.c0a80101-0000-4000-8000-000000000001", anonKey);
console.log("anon after price", anonAfter.status, anonAfter.body);

const restock = await rest("rpc/pos_manager_adjust_color_stock", managerToken, {
  method: "POST",
  body: JSON.stringify({
    p_product_id: "c0a80101-0000-4000-8000-000000000001",
    p_color_id: "c0a80201-0000-4000-8000-000000000001",
    p_delta: 2,
    p_reason: "phase3_check",
  }),
});
console.log("restock", restock.status, restock.body);

const moved = await rest("stock_movements?select=product_id,color_id,delta,quantity_after,reason&order=created_at.desc&limit=1", managerToken);
console.log("stock movement", moved.status, moved.body);

const cashierUpdate = await rest("rpc/pos_manager_adjust_color_stock", cashierToken, {
  method: "POST",
  body: JSON.stringify({
    p_product_id: "c0a80101-0000-4000-8000-000000000001",
    p_color_id: "c0a80201-0000-4000-8000-000000000001",
    p_delta: 1,
  }),
});
console.log("cashier restock", cashierUpdate.status, cashierUpdate.body);

const cashierWrite = await rest("products?id=eq.c0a80101-0000-4000-8000-000000000002", cashierToken, {
  method: "PATCH",
  body: JSON.stringify({ base_price: 1 }),
});
console.log("cashier direct write", cashierWrite.status, cashierWrite.body);

const cashierMovements = await rest("stock_movements?select=id&limit=1", cashierToken);
console.log("cashier stock movements", cashierMovements.status, cashierMovements.body);
