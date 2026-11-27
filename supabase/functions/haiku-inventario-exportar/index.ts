import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import ExcelJS from "npm:exceljs@4.4.0";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { exportarExcel, exportarPdf, mimeInventario } from "./documentos.mjs";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function responder(body: object,status=200) {
  return new Response(JSON.stringify(body),{status,headers});
}

function base64(bytes: Uint8Array) {
  let texto="";
  for (let i=0;i<bytes.length;i+=8192) texto+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(texto);
}

Deno.serve(async (request) => {
  if (request.method==="OPTIONS") return new Response(null,{status:204,headers});
  if (request.method!=="POST") return responder({mensaje:"Método no permitido."},405);
  const authorization=request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return responder({mensaje:"Inicia sesión para descargar."},401);
  let formato: string;
  try { ({formato}=await request.json()); }
  catch { return responder({mensaje:"Solicitud de descarga inválida."},400); }
  if (formato!=="xlsx"&&formato!=="pdf") return responder({mensaje:"Elige Excel o PDF."},400);
  try {
    const client=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{
      global:{headers:{Authorization:authorization}},
      auth:{persistSession:false,autoRefreshToken:false},
    });
    const {data,error}=await client.rpc("haiku_inventario_leer_v1",{p_vista:"exportar"});
    if (error) {
      if (error.code==="42501") return responder({mensaje:"No tienes acceso a Inventario."},403);
      if (error.code==="PGRST301") return responder({mensaje:"La sesión venció. Inicia sesión nuevamente."},401);
      console.error("Inventario: no se pudo consultar la exportación",error.code);
      return responder({mensaje:"No se pudo consultar el inventario."},502);
    }
    const archivo=formato==="xlsx"
      ? await exportarExcel(data,ExcelJS.Workbook)
      : await exportarPdf(data,{PDFDocument,StandardFonts,rgb});
    const partes=new Intl.DateTimeFormat("en-CA",{
      timeZone:"America/Santiago",year:"numeric",month:"2-digit",day:"2-digit",
    }).formatToParts(new Date());
    const dia=["year","month","day"].map(t=>partes.find(p=>p.type===t)?.value).join("-");
    return responder({nombre:"Inventario_HAIKU_"+dia+"."+formato,mime:mimeInventario(formato),base64:base64(archivo)});
  } catch (error) {
    console.error("Inventario: error al generar el archivo",error instanceof Error?error.name:"Error");
    return responder({mensaje:"No se pudo generar el archivo. Intenta nuevamente."},500);
  }
});
