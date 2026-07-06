import { describe, it, expect } from "vitest";
import { filterMatch } from "./filters";

describe("filterMatch — prédicat de filtre transverse", () => {
  it("critère vide n'exclut jamais", () => {
    expect(filterMatch({ bu: "", am: "", client: "", pm: "" }, { bu: "ICT" })).toBe(true);
  });
  it("insensible à la casse / espaces", () => {
    expect(filterMatch({ bu: " ict ", am: "", client: "", pm: "" }, { bu: "ICT" })).toBe(true);
  });
  it("exclut si la dimension diffère", () => {
    expect(filterMatch({ bu: "ICT", am: "", client: "", pm: "" }, { bu: "CLOUD" })).toBe(false);
  });
  it("dims restreint les dimensions testées", () => {
    expect(filterMatch({ bu: "", am: "X", client: "", pm: "" }, { am: "Y" }, ["bu"])).toBe(true); // AM non testé
    expect(filterMatch({ bu: "", am: "X", client: "", pm: "" }, { am: "Y" }, ["am"])).toBe(false);
  });
  it("combinaison multi-critères (ET)", () => {
    expect(filterMatch({ bu: "ICT", am: "DATCHA", client: "", pm: "" }, { bu: "ICT", am: "DATCHA" })).toBe(true);
    expect(filterMatch({ bu: "ICT", am: "DATCHA", client: "", pm: "" }, { bu: "ICT", am: "KOUADIO" })).toBe(false);
  });
});
