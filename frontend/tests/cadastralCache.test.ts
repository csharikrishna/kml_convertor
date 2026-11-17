import { describe, it, expect } from "vitest";
import {
  getCachedProject,
  setCachedProject,
  loadProjectOfflineFirst,
} from "../src/lib/cache/cadastralCache";
import { CadastralProjectData } from "../src/stores/useCadastralStore";

describe("CadastralCache & Offline-First Data Delivery", () => {
  const dummyData: CadastralProjectData = {
    success: true,
    village: "CacheVillage",
    mandal: "CacheMandal",
    district: "CacheDistrict",
    summary: {
      total_plots: 2,
      affected_plots: 1,
      total_area_acres: 5.0,
      acquired_area_acres: 1.0,
      balance_area_acres: 4.0,
    },
    layers: {
      survey_plots: null,
      canal_alignment: null,
      canal_buffer: null,
      roads: null,
      village_boundary: null,
      structures: null,
      chainage_markers: null,
    },
    survey_register: [
      {
        survey_no: "1",
        village: "CacheVillage",
        mandal: "CacheMandal",
        district: "CacheDistrict",
        total_area_m2: 20234,
        total_acres: 5.0,
        total_ac_cts: "5 Ac 0 Cts",
        canal_passing: true,
        acquired_area_m2: 4046,
        acquired_acres: 1.0,
        balance_area_m2: 16188,
        balance_acres: 4.0,
        chainage_range: "Non-acquired",
        canal_length_m: 0,
        canal_width_m: 0,
      },
    ],
  };

  it("stores and retrieves project data via cache layer", async () => {
    await setCachedProject("test_proj", dummyData);
    const cached = await getCachedProject("test_proj");

    expect(cached).not.toBeNull();
    expect(cached?.data.village).toBe("CacheVillage");
    expect(cached?.data.survey_register.length).toBe(1);
    expect(cached?.timestamp).toBeGreaterThan(0);
  });

  it("supports offline-first loading with deduplication", async () => {
    let fetchCount = 0;
    const fetchFn = async () => {
      fetchCount++;
      return dummyData;
    };

    // First load: fetches and stores
    const first = await loadProjectOfflineFirst("offline_test", fetchFn);
    expect(first.data.village).toBe("CacheVillage");
    expect(first.fromCache).toBe(false);
    expect(fetchCount).toBe(1);

    // Second load: returns from cache without fetching again!
    const second = await loadProjectOfflineFirst("offline_test", fetchFn);
    expect(second.data.village).toBe("CacheVillage");
    expect(second.fromCache).toBe(true);
    expect(fetchCount).toBe(1); // Not incremented!
  });
});
