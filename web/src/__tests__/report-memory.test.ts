import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LibraryList } from "@/components/LibraryList";
import { LibraryDrawer } from "@/components/LibraryDrawer";
import { FullReportNotice } from "@/components/FullReportNotice";
import { currentOccupancy } from "@/lib/estimate";
import { parseLibraryRow, parseOccupancyStatus } from "@/lib/occupancy";
import { currentReportPct, reportMemoryNotice } from "@/lib/report-priority";

const NOW=Date.parse("2027-07-15T10:00:00Z");
function fixture() {
  return parseLibraryRow({id:"test",name:"Synthetic memory fixture",lat:40.4,lng:-3.7,total_capacity:100,
    historical_popularity:{model:"csv-v1"},
    opening_hours:{requires_review:false,timezone:"Europe/Madrid",weekly:Object.fromEntries([1,2,3,4,5,6,7].map(d=>[d,[["00:00","24:00"]]]))},
    occupancy_status:{library_id:"test",is_open_now:true,final_occupancy_pct:90,bayesian_occupancy:70,
      report_memory_pct:90,report_memory_at:new Date(NOW-2*3600_000).toISOString(),report_memory_count:1,
      active_reports_count:0,full_reported_at:null,base_observed_at:new Date(NOW).toISOString(),
      base_valid_until:new Date(NOW+30*60_000).toISOString(),updated_at:new Date(NOW).toISOString()}})!;
}

describe("memoria de reportes fuera de la ventana reciente",()=>{
  it("conserva la proyección sin volver al posterior que perdió los reportes a los 90 minutos",()=>{
    const lib=fixture();
    expect(currentOccupancy(lib,NOW).final_occupancy_pct).toBe(90);
    expect(currentReportPct(lib.occupancy!,NOW)).toBe(90);
    expect(lib.occupancy!.active_reports_count).toBe(0);
    expect(reportMemoryNotice(lib.occupancy,NOW)).toContain("hace 2 horas");
  });
  it("el desvanecimiento del 100% vuelve a la memoria y no al histórico",()=>{
    const status={...fixture().occupancy!,report_memory_pct:95,full_reported_at:new Date(NOW-12.5*60_000).toISOString()};
    expect(currentReportPct(status,NOW)).toBe(98);
  });
  it("una actualización con nuevos reportes bajos sustituye la memoria anterior",()=>{
    const lib=fixture();
    lib.occupancy={...lib.occupancy!,report_memory_pct:40,report_memory_at:new Date(NOW).toISOString(),final_occupancy_pct:40};
    expect(currentOccupancy(lib,NOW).final_occupancy_pct).toBe(40);
    expect(reportMemoryNotice(lib.occupancy,NOW)).toBeNull();
  });
  it("caduca la memoria de una copia en caché al llegar a seis horas",()=>{
    const status={...fixture().occupancy!,report_memory_at:new Date(NOW-6*3600_000).toISOString()};
    expect(currentReportPct(status,NOW)).toBe(70);
    expect(reportMemoryNotice(status,NOW)).toBeNull();
  });
  it("un cierre explícito gana y retira el aviso",()=>{
    const lib=fixture(); lib.opening_hours.date_overrides={"2027-07-15":[]};
    const status=currentOccupancy(lib,NOW);
    expect(status.is_open_now).toBe(false);
    expect(status.final_occupancy_pct).toBe(0);
    expect(reportMemoryNotice(status,NOW)).toBeNull();
  });
  it("no presenta observaciones antiguas como un nuevo reporte de sala completa",()=>{
    const html=renderToStaticMarkup(createElement(FullReportNotice,{status:fixture().occupancy,now:NOW}));
    expect(html).toContain("Estimación apoyada en reportes");
    expect(html).not.toContain("Reportada completa");
  });
  it("parsea snapshots nuevos y antiguos sin inventar memoria",()=>{
    expect(parseOccupancyStatus(fixture().occupancy)?.report_memory_pct).toBe(90);
    expect(parseOccupancyStatus({library_id:"test"})?.report_memory_pct).toBeNull();
    expect(parseOccupancyStatus({library_id:"test"})?.report_memory_count).toBe(0);
  });
  for(const component of ["list","map-detail"] as const){
    it(`${component}: muestra plazas y antigüedad coherentes con la memoria`,()=>{
      const lib=fixture(); lib.occupancy=currentOccupancy(lib,NOW);
      const html=renderToStaticMarkup(component==="list" ? createElement(LibraryList,{
        items:[{library:lib,distanceM:null}],total:1,loading:false,error:null,now:NOW,selectedId:null,filtersActive:false,
        onSelect(){},onClearFilters(){},onRetry(){},
      }) : createElement(LibraryDrawer,{
        library:lib,distanceM:null,now:NOW,locationGranted:false,
        locate:async()=>({lat:40.4,lng:-3.7,accuracy:10,timestamp:NOW}),onReported(){},onClose(){},
      }));
      expect(html).toContain("~10 libres de 100 plazas");
      expect(html).toContain("Estimación apoyada en reportes de hace 2 horas");
    });
  }
});
