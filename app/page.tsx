"use client";

import { useMemo, useState } from "react";

type TaxProfile = 0 | 1 | 2;
type ExitStrategy = "taxable" | "1031";
type ScenarioName = "Optimistic" | "Base" | "Conservative";
type MobileTab = "inputs" | "deal" | "projection" | "exit";

const defaults = {
  price: 200000, down: 20, rate: 6.75, term: 30, rent: 2000,
  rentIncrease: 3, tax: 2822, insurance: 900, hoa: 343,
  vacancy: 5, reserves: 3, maintenance: 5, management: 0,
  years: 5, appreciation: 2, selling: 7.5, buildingBasis: 80,
  recaptureRate: 25, capitalGains: 15, federalRate: 24, stateRate: 0,
  magi: 100000, filingStatus: 0, taxProfile: 0 as TaxProfile,
  exitStrategy: "taxable" as ExitStrategy, replacementPrice: 250000,
  additionalCash: 0, stockReturn: 7.5,
};

const money = (n:number) => new Intl.NumberFormat("en-US", { style:"currency", currency:"USD", maximumFractionDigits:0 }).format(Number.isFinite(n) ? n : 0);
const percent = (n:number) => `${(Number.isFinite(n) ? n : 0).toFixed(1)}%`;
const clamp = (n:number, min:number, max:number) => Math.min(max, Math.max(min, n));

function model(base:typeof defaults, vacancy=base.vacancy, maintenance=base.maintenance) {
  const months = Math.max(1, Math.round(base.years * 12));
  const monthlyRate = base.rate / 1200;
  const loanMonths = Math.max(1, Math.round(base.term * 12));
  const loan = base.price * (1 - base.down / 100);
  const payment = monthlyRate
    ? loan * monthlyRate * Math.pow(1 + monthlyRate, loanMonths) / (Math.pow(1 + monthlyRate, loanMonths) - 1)
    : loan / loanMonths;
  const priceGrowth = Math.pow(1 + base.appreciation / 100, 1 / 12) - 1;
  const stockMonthly = Math.pow(1 + base.stockReturn / 100, 1 / 12) - 1;
  const annualDepreciation = base.price * base.buildingBasis / 100 / 27.5;
  const combinedTaxRate = (base.federalRate + base.stateRate) / 100;
  const cashInvested = base.price * base.down / 100 + base.price * .025;
  let balance = loan, reserve = 0, hypotheticalMarket = 0, suspended = 0, cumulativeCash = 0, cumulativeUsableTax = 0, totalLossPool = 0, cumulativeTaxCost = 0, totalTaxableIncome = 0;
  const monthly:any[] = [], yearly:any[] = [];
  let yearBucket:any = null;

  for (let m=0; m<months; m++) {
    const year = Math.floor(m / 12) + 1;
    // Rent steps up once per year (at the START of each new year), then holds flat for all 12
    // months of that year — it does NOT compound month-to-month within a year.
    const rent = base.rent * Math.pow(1 + base.rentIncrease / 100, Math.floor(m / 12));
    const vacancyCost = rent * vacancy / 100;
    const propertyTax = base.tax / 12;
    const insurance = base.insurance / 12;
    const hoa = base.hoa;
    const reserves = rent * base.reserves / 100;
    const repairs = rent * maintenance / 100;
    const management = rent * base.management / 100;
    const noi = rent - vacancyCost - propertyTax - insurance - hoa - reserves - repairs - management;
    const interest = balance > 0 ? balance * monthlyRate : 0;
    const principal = balance > 0 ? Math.min(balance, Math.max(0, payment - interest)) : 0;
    const debt = balance > 0 ? interest + principal : 0;
    balance = Math.max(0, balance - principal);
    const cashFlow = noi - debt;
    // Reserve is a plain running cash balance — NOT invested anywhere, no growth assumed. This is
    // what makes "Total profit" and "Combined exit value" reconcile exactly (see below).
    reserve += cashFlow;
    // Hypothetical-only comparison: what the SAME cash flow would be worth if you separately chose
    // to invest it in the market instead of holding it as cash. Shown only as an optional side-by-side
    // comparison card — it is never added into totalProfit, headlineRoi, combinedExitValue, or IRR.
    hypotheticalMarket = hypotheticalMarket >= 0 ? hypotheticalMarket * (1 + stockMonthly) + cashFlow : hypotheticalMarket + cashFlow;
    cumulativeCash += cashFlow;
    const propertyValue = base.price * Math.pow(1 + priceGrowth, m + 1);
    const row = { month:m+1, year, rent, vacancyCost, propertyTax, insurance, hoa, reserves, repairs, management, noi, interest, principal, debt, cashFlow, balance, propertyValue, reserve, hypotheticalMarket };
    monthly.push(row);
    if (!yearBucket || yearBucket.year !== year) yearBucket = { year, rent:0, noi:0, cashFlow:0, interest:0, principal:0, taxBenefit:0, taxCost:0, suspended:0 };
    yearBucket.rent += rent; yearBucket.noi += noi; yearBucket.cashFlow += cashFlow; yearBucket.interest += interest; yearBucket.principal += principal;
    if ((m+1)%12===0 || m===months-1) {
      const operatingBeforeInterest = yearBucket.noi;
      const interestAndDepreciation = yearBucket.interest + annualDepreciation;
      // The rental activity nets to ONE number for the year: NOI minus interest+depreciation.
      // If negative, it's a passive loss governed by §469 (usable-vs-suspended split by Tax Profile).
      // If positive, it's ordinary taxable passive income — §469 never shields positive passive
      // income from tax for ANY profile (REPS/active/passive only affects loss deductibility), so
      // this tax cost is symmetric and identical across all three Tax Profiles.
      const netRentalResult = operatingBeforeInterest - interestAndDepreciation;
      // STEP 1: total loss pool for the year — computed ONCE, 100% independent of Tax Profile.
      // Tax Profile only ever changes how this fixed pool is split between "usable now" and
      // "suspended until sale".
      const generatedLoss = Math.max(0, -netRentalResult);
      totalLossPool += generatedLoss;
      const taxableRentalIncome = Math.max(0, netRentalResult);
      totalTaxableIncome += taxableRentalIncome;
      // STEP 2: allocate the SAME loss pool across the three IRC §469 treatments — split only, no re-derivation.
      let usableLoss = 0;
      if (base.taxProfile === 2) {
        usableLoss = generatedLoss; // REPS + material participation: 100% usable, 0% suspended
      } else if (base.taxProfile === 1) {
        const allowanceCap = clamp(25000 - Math.max(0, base.magi - 100000) / 2, 0, 25000); // $25k MAGI phase-out
        usableLoss = Math.min(generatedLoss, allowanceCap); // Active participation: usable up to the capped allowance
      } else {
        usableLoss = 0; // Passive investor / no REPS: $0 usable every year, 100% suspended until sale
      }
      const currentTaxBenefit = usableLoss * combinedTaxRate;
      // STEP 3: symmetric ordinary-income tax cost on positive net rental result — same for every profile.
      const currentTaxCost = taxableRentalIncome * combinedTaxRate;
      const newlySuspended = generatedLoss - usableLoss;
      suspended += newlySuspended;
      cumulativeUsableTax += currentTaxBenefit;
      cumulativeTaxCost += currentTaxCost;
      // Add this year's NET tax effect (benefit added, cost subtracted) to the reserve at face value,
      // same as operating cash flow — no market growth assumed. Suspended-loss release at sale is NOT
      // added here — see sale section.
      reserve += currentTaxBenefit - currentTaxCost;
      // Hypothetical-only: same net tax effect, but compounded in the market comparison track.
      hypotheticalMarket += currentTaxBenefit - currentTaxCost;
      yearBucket.taxBenefit = currentTaxBenefit; yearBucket.taxCost = currentTaxCost; yearBucket.suspended = suspended;
      yearBucket.generatedLoss = generatedLoss; yearBucket.usableLoss = usableLoss; yearBucket.taxableRentalIncome = taxableRentalIncome;
      yearBucket.rent = yearBucket.rent / Math.max(1, (m%12)+1);
      yearBucket.value = propertyValue; yearBucket.balance = balance; yearBucket.reserve = reserve; yearBucket.hypotheticalMarket = hypotheticalMarket;
      yearly.push(yearBucket); yearBucket = null;
    }
  }

  const first = yearly[0];
  const salePrice = monthly[monthly.length-1].propertyValue;
  const sellingCosts = salePrice * base.selling / 100;
  const accumulatedDepreciation = annualDepreciation * base.years;
  const adjustedBasis = base.price - accumulatedDepreciation;
  const totalGain = Math.max(0, salePrice - sellingCosts - adjustedBasis);
  const recaptureGain = Math.min(accumulatedDepreciation, totalGain);
  const capitalGain = Math.max(0, totalGain - recaptureGain);
  const fullRecaptureTax = recaptureGain * base.recaptureRate / 100;
  const fullCapitalGainTax = capitalGain * base.capitalGains / 100;
  const fullSaleTax = fullRecaptureTax + fullCapitalGainTax;
  const preTaxEquity = salePrice - sellingCosts - balance;
  const suspendedReleaseBenefit = base.exitStrategy === "taxable" ? suspended * combinedTaxRate : 0;
  const taxableNetSale = preTaxEquity - fullSaleTax;

  const reinvestedValue = Math.max(0, base.replacementPrice + base.additionalCash);
  const boot = Math.max(0, preTaxEquity - reinvestedValue);
  const bootRatio = preTaxEquity > 0 ? clamp(boot / preTaxEquity, 0, 1) : 0;
  const bootTax = fullSaleTax * bootRatio;
  const deferredTax = Math.max(0, fullSaleTax - bootTax);
  const carryoverBasis = Math.max(0, adjustedBasis + base.additionalCash - boot);
  const replacementDepreciableBasis = carryoverBasis * base.buildingBasis / 100;
  const replacementAnnualDepreciation = replacementDepreciableBasis / 27.5;
  const netBootCash = Math.max(0, boot - bootTax);

  const selectedNetSale = base.exitStrategy === "taxable" ? taxableNetSale : preTaxEquity;
  const totalProfit = selectedNetSale + cumulativeCash + cumulativeUsableTax - cumulativeTaxCost + suspendedReleaseBenefit - cashInvested;
  const headlineRoi = cashInvested ? totalProfit / cashInvested * 100 : 0;
  const propertyExitEquity = base.exitStrategy === "taxable" ? taxableNetSale + suspendedReleaseBenefit : preTaxEquity;
  // Reserve (cash flow + net tax effect, held at face value, no market assumption) is the SAME set of
  // dollars used in "Total profit" above, so this reconciles exactly:
  //   combinedExitValue - cashInvested === totalProfit   (always, algebraically, no gap)
  const combinedExitValue = propertyExitEquity + reserve;
  // Hypothetical-only comparison value: same property exit equity, but paired with the market-compounded
  // track instead of the plain reserve. Shown side-by-side for reference only — excluded from headline
  // IRR/ROI so the primary numbers never assume you invested cash flow in the market.
  const hypotheticalMarketExitValue = propertyExitEquity + hypotheticalMarket;
  const afterTaxIrr = cashInvested > 0 && combinedExitValue > 0 ? (Math.pow(combinedExitValue / cashInvested, 1 / base.years) - 1) * 100 : 0;
  const hypotheticalMarketIrr = cashInvested > 0 && hypotheticalMarketExitValue > 0 ? (Math.pow(hypotheticalMarketExitValue / cashInvested, 1 / base.years) - 1) * 100 : 0;
  // PRE-TAX return/IRR: strips out every tax term entirely (usable benefit, ordinary tax cost, sale tax,
  // suspended-loss release) — leaving pure property + financing economics: preTaxEquity plus raw cash
  // flow. This is deliberately IDENTICAL across all Tax Profiles and both Exit Strategies, since §469
  // and capital-gains treatment only affect the tax layer, never the underlying deal economics. This is
  // the correct, apples-to-apples number to stack against a quoted S&P 500 return, which is also pre-tax.
  const pretaxProfit = preTaxEquity + cumulativeCash - cashInvested;
  const pretaxRoi = cashInvested ? pretaxProfit / cashInvested * 100 : 0;
  const pretaxCombinedExitValue = preTaxEquity + cumulativeCash;
  const pretaxIrr = cashInvested > 0 && pretaxCombinedExitValue > 0 ? (Math.pow(pretaxCombinedExitValue / cashInvested, 1 / base.years) - 1) * 100 : 0;
  const capRate = base.price ? first.noi / base.price * 100 : 0;
  const coc = cashInvested ? first.cashFlow / cashInvested * 100 : 0;
  const dscr = payment * 12 ? first.noi / (payment * 12) : 0;

  return { monthly, yearly, first, loan, payment, balance, cashInvested, capRate, coc, dscr, cumulativeCash, cumulativeUsableTax, cumulativeTaxCost, totalTaxableIncome, suspended, suspendedReleaseBenefit, totalLossPool, reserve, hypotheticalMarket, hypotheticalMarketExitValue, hypotheticalMarketIrr, salePrice, sellingCosts, adjustedBasis, accumulatedDepreciation, totalGain, recaptureGain, capitalGain, fullRecaptureTax, fullCapitalGainTax, fullSaleTax, preTaxEquity, taxableNetSale, selectedNetSale, totalProfit, headlineRoi, pretaxProfit, pretaxRoi, pretaxCombinedExitValue, pretaxIrr, boot, bootRatio, bootTax, netBootCash, deferredTax, carryoverBasis, replacementDepreciableBasis, replacementAnnualDepreciation, propertyExitEquity, combinedExitValue, afterTaxIrr };
}

export default function Home(){
  const [v,setV]=useState(defaults);
  const [scenario,setScenario]=useState<ScenarioName>("Base");
  const [showRoi,setShowRoi]=useState(false);
  const [mobileTab,setMobileTab]=useState<MobileTab>("inputs");
  const set=(k:keyof typeof defaults,x:string)=>setV(s=>({...s,[k]:Number(x)}));
  const applyScenario=(name:ScenarioName)=>{const map={Optimistic:[3,3],Base:[5,5],Conservative:[7,7]} as const;setScenario(name);setV(s=>({...s,vacancy:map[name][0],maintenance:map[name][1]}));};
  const c=useMemo(()=>model(v),[v]);
  const scenarios=useMemo(()=>[{name:"Optimistic",...model({...v,years:5,vacancy:3,maintenance:3})},{name:"Base",...model({...v,years:5,vacancy:5,maintenance:5})},{name:"Conservative",...model({...v,years:5,vacancy:7,maintenance:7})}], [v]);
  const spread=v.rate-c.capRate;
  const leverageClass=spread>=1.5?"danger":spread>=1?"warning":"note";
  const dscrClass=c.dscr>=1.25?"healthy":c.dscr>=1.1?"marginal":"weak";
  const roiLabel=v.exitStrategy==="1031"?"Economic ROI":"After-tax ROI";
  const netSaleHint=v.exitStrategy==="taxable"
    ?`${money(c.salePrice)} sale price − ${money(c.sellingCosts)} selling costs − ${money(c.balance)} loan payoff − ${money(c.fullSaleTax)} sale taxes`
    :`${money(c.salePrice)} sale price − ${money(c.sellingCosts)} selling costs − ${money(c.balance)} loan payoff (pre-tax; taxes deferred via 1031)`;
  const saleTaxHint=v.exitStrategy==="taxable"
    ?`Long-term capital gains treatment (held ${v.years}yr > 1yr), not a government real-estate transfer/sales tax. ${money(c.recaptureGain)} depreciation recapture × ${v.recaptureRate}% + ${money(c.capitalGain)} capital gain × ${v.capitalGains}% LTCG`
    :`${money(c.fullSaleTax)} total gain tax (recapture + LTCG) × ${percent(c.bootRatio*100)} boot ratio — only cash not reinvested in the replacement property is taxed now; the rest is deferred`;
  const openTab=(tab:MobileTab)=>{setMobileTab(tab);window.scrollTo({top:0,behavior:"smooth"});};
  return <main className={`mobile-tab-${mobileTab}`}>
    <header className="app-header"><div className="brand"><img src="/logo-mark.svg" alt="EstateIQ" /><div><h1>EstateIQ</h1><p>Know the deal before you buy.</p></div></div><span>{v.years}-YEAR HOLD</span></header>
    <div className="sticky-summary"><span>{roiLabel} <b>{percent(c.headlineRoi)}</b></span><span>Cap <b>{percent(c.capRate)}</b></span><span>CoC <b>{percent(c.coc)}</b></span><span>After-tax IRR <b>{percent(c.afterTaxIrr)}</b></span><span>Pre-tax IRR <b>{percent(c.pretaxIrr)}</b></span></div>
    <section className="dashboard">
      <aside className="panel assumptions mobile-pane mobile-inputs"><h2>Assumptions</h2><p>Results update instantly.</p><div className="scenario-toggle">{(["Optimistic","Base","Conservative"] as ScenarioName[]).map(x=><button className={scenario===x?"active":""} onClick={()=>applyScenario(x)} key={x}>{x}</button>)}</div><div className="fields">
        <F l="Property price" v={v.price} k="price" p="$" s={set}/><F l="Down payment" v={v.down} k="down" x="%" s={set}/><F l="Mortgage rate" v={v.rate} k="rate" x="%" s={set}/><F l="Loan term" v={v.term} k="term" x="yrs" s={set}/><F l="Monthly rent" v={v.rent} k="rent" p="$" s={set}/><F l="Rent increase" v={v.rentIncrease} k="rentIncrease" x="%" s={set}/><F l="Property tax / yr" v={v.tax} k="tax" p="$" s={set}/><F l="Insurance / yr" v={v.insurance} k="insurance" p="$" s={set}/><F l="HOA / month" v={v.hoa} k="hoa" p="$" s={set}/><F l="Vacancy" v={v.vacancy} k="vacancy" x="%" s={set}/><F l="Reserves" v={v.reserves} k="reserves" x="% rent" s={set}/><F l="Maintenance" v={v.maintenance} k="maintenance" x="% rent" s={set}/><F l="Management" v={v.management} k="management" x="%" s={set}/><F l="Hold period" v={v.years} k="years" x="yrs" s={set}/><F l="Appreciation" v={v.appreciation} k="appreciation" x="%" s={set}/><F l="Selling costs" v={v.selling} k="selling" x="%" s={set}/><F l="Building basis" v={v.buildingBasis} k="buildingBasis" x="%" s={set}/><F l="Recapture tax" v={v.recaptureRate} k="recaptureRate" x="%" s={set}/><F l="Capital-gains tax" v={v.capitalGains} k="capitalGains" x="%" s={set}/><F l="Federal tax rate" v={v.federalRate} k="federalRate" x="%" s={set}/><F l="State tax rate" v={v.stateRate} k="stateRate" x="%" s={set}/><F l="MAGI" v={v.magi} k="magi" p="$" s={set}/><F l="S&P return (comparison only)" v={v.stockReturn} k="stockReturn" x="%" s={set}/>
      </div><Select label="Filing status" value={v.filingStatus} onChange={x=>set("filingStatus",x)} options={[[0,"Single"],[1,"Married Filing Jointly"]]}/><Select label="Tax profile" value={v.taxProfile} onChange={x=>set("taxProfile",x)} options={[[0,"Passive investor / no REPS"],[1,"Active participation"],[2,"REPS + material participation"]]}/><Select label="Exit strategy" value={v.exitStrategy} onChange={x=>setV(s=>({...s,exitStrategy:x as ExitStrategy}))} options={[["taxable","Taxable sale"],["1031","1031 exchange (defer taxes)"]]}/>{v.exitStrategy==="1031"&&<div className="fields exchange-fields"><F l="Replacement price" v={v.replacementPrice} k="replacementPrice" p="$" s={set}/><F l="Additional cash" v={v.additionalCash} k="additionalCash" p="$" s={set}/></div>}<div className="input-help">ⓘ Vacancy and maintenance defaults reflect a conservative single-unit estimate. Adjust for local turnover and property condition.</div><button className="reset" onClick={()=>setV(defaults)}>Reset assumptions</button></aside>
      <div className="results-area">
        <div className="kpi-row mobile-pane mobile-deal"><Kpi label="Cap rate" value={percent(c.capRate)} sub="Year 1 NOI / price"/><Kpi label="Cash-on-cash" value={percent(c.coc)} sub="Year 1 cash flow"/><Kpi label="DSCR" value={`${c.dscr.toFixed(2)}x`} sub={c.dscr<1.2?"Below typical lender minimum":"Debt coverage"} tone={dscrClass}/><Kpi label="Monthly cash flow" value={money(c.first.cashFlow/12)} sub="After debt service"/></div>
        {spread>0&&<div className={`risk-banner ${leverageClass} mobile-pane mobile-deal`}><b>⚠ Negative leverage: cap rate {percent(c.capRate)} is below financing rate {percent(v.rate)}.</b><span> Leverage is reducing your current cash yield. Appreciation, rent growth, cap-rate compression, or tax benefits must offset the spread.</span></div>}
        {v.taxProfile===0&&c.suspended>0&&<div className="risk-banner warning mobile-pane mobile-deal"><b>ⓘ Suspended passive losses: {money(c.suspended)}</b><span> These do not reduce current ordinary-income taxes and are carried forward.</span></div>}
        <div className="content-grid"><section className="panel bridge mobile-pane mobile-deal"><h2>Year 1 monthly cash-flow bridge</h2><Line l="Gross rent" v={c.monthly[0].rent}/><Line l="Less: vacancy" v={-c.monthly[0].vacancyCost}/><Line l="Property tax" v={-c.monthly[0].propertyTax}/><Line l="Insurance" v={-c.monthly[0].insurance}/><Line l="HOA" v={-c.monthly[0].hoa}/><Line l="Reserves + maintenance" v={-(c.monthly[0].reserves+c.monthly[0].repairs)}/><Line l="Management" v={-c.monthly[0].management}/><Line l="NOI before debt" v={c.monthly[0].noi} strong/><Line l="Mortgage P&I" v={-c.monthly[0].debt}/><Line l="Monthly cash flow" v={c.monthly[0].cashFlow} strong/><h3>Return bridge</h3><Line l="Cash + principal" v={(c.monthly[0].cashFlow+c.monthly[0].principal)} strong/>{c.first.taxBenefit>0&&<div className="tax-benefit-callout">⚠ +{money(c.first.taxBenefit/12)} potential tax benefit / month equivalent — not guaranteed cash</div>}{c.first.taxCost>0&&<div className="tax-cost-callout">⚠ −{money(c.first.taxCost/12)} ordinary tax cost / month equivalent — NOI exceeds interest + depreciation this year, so the excess is taxable passive income for every Tax Profile</div>}<div className="suspended-callout">Suspended losses carried forward: <b>{money(c.suspended)}</b></div><div className="loss-pool-callout"><b>IRC §469 loss allocation (Tax Profile only shifts timing)</b><span>Total {v.years}-yr loss pool, pre-tax — fixed regardless of Tax Profile: <b>{money(c.totalLossPool)}</b></span><span>Tax value of pool @ {percent((v.federalRate+v.stateRate))}: <b>{money(c.totalLossPool*(v.federalRate+v.stateRate)/100)}</b> = Usable now {money(c.cumulativeUsableTax)} + Suspended-until-sale {money(c.suspendedReleaseBenefit)}</span>{c.totalTaxableIncome>0&&<span>Total {v.years}-yr taxable rental income (years NOI &gt; interest+depreciation) — taxed at ordinary rates for every Tax Profile, not shielded by REPS/active/passive status: <b>{money(c.totalTaxableIncome)}</b> → tax cost <b>{money(c.cumulativeTaxCost)}</b></span>}</div></section>
          <section className="panel projection mobile-pane mobile-projection"><h2>Hold projection</h2><div className="table-wrap"><div className="year-table"><div className="year-row year-head"><span>Year</span><span>Rent</span><span>NOI</span><span>Cash flow</span><span>Tax effect</span><span>Principal</span><span>Value</span></div>{c.yearly.map(y=><div className="year-row" key={y.year}><span>{y.year}</span><span>{money(y.rent)}</span><span>{money(y.noi)}</span><span className={y.cashFlow>=0?"positive":"negative"}>{money(y.cashFlow)}</span><span className={y.taxBenefit>y.taxCost?"positive":y.taxCost>0?"negative":""}>{money(y.taxBenefit-y.taxCost)}</span><span>{money(y.principal)}</span><span>{money(y.value)}</span></div>)}</div></div><div className="exit-cards"><Card label="Net sale proceeds" value={money(c.selectedNetSale)} hint={netSaleHint}/><Card label="Sale taxes" value={money(v.exitStrategy==="1031"?c.bootTax:c.fullSaleTax)} hint={saleTaxHint}/><Card label="Cumulative cash flow" value={money(c.cumulativeCash)}/><Card label="Total profit" value={money(c.totalProfit)} accent/></div><button className="breakdown-toggle" onClick={()=>setShowRoi(x=>!x)}>{showRoi?"Hide":"Show"} ROI breakdown</button>{showRoi&&<div className="roi-breakdown"><Line l="Initial cash invested" v={-c.cashInvested}/><Line l="Cumulative operating cash flow" v={c.cumulativeCash}/><Line l="Total loss pool (pre-tax, fixed across Tax Profiles)" v={c.totalLossPool}/><Line l="Usable tax benefit" v={c.cumulativeUsableTax}/><Line l="Ordinary tax cost (positive rental yrs, same for every Tax Profile)" v={-c.cumulativeTaxCost}/><Line l="Net sale proceeds" v={c.selectedNetSale}/><Line l="Suspended losses released at sale" v={c.suspendedReleaseBenefit}/><Line l="Total profit" v={c.totalProfit} strong/><Line l={`${roiLabel}`} v={c.headlineRoi} suffix="%" strong/><Line l="Pre-tax profit (no §469/sale tax effects — comparable to S&P)" v={c.pretaxProfit} strong/><Line l="Pre-tax ROI" v={c.pretaxRoi} suffix="%" strong/></div>}</section></div>
        <div className="scenario-row mobile-pane mobile-projection">{scenarios.map(s=><div key={s.name}><b>{s.name}</b><span>CoC {percent(s.coc)}</span><span>DSCR {s.dscr.toFixed(2)}x</span><span>After-tax {percent(s.afterTaxIrr)}</span><span>Pre-tax {percent(s.pretaxIrr)}</span></div>)}</div>
        <section className="panel mobile-only-exit mobile-pane mobile-exit"><h2>Exit and ROI summary</h2><div className="exit-cards"><Card label="Net sale proceeds" value={money(c.selectedNetSale)} hint={netSaleHint}/><Card label="Sale taxes" value={money(v.exitStrategy==="1031"?c.bootTax:c.fullSaleTax)} hint={saleTaxHint}/><Card label="Suspended loss release" value={money(c.suspendedReleaseBenefit)}/><Card label="Total profit" value={money(c.totalProfit)} accent/></div><div className="roi-breakdown always-open"><Line l="Initial cash invested" v={-c.cashInvested}/><Line l="Cumulative operating cash flow" v={c.cumulativeCash}/><Line l="Total loss pool (pre-tax, fixed across Tax Profiles)" v={c.totalLossPool}/><Line l="Usable tax benefit" v={c.cumulativeUsableTax}/><Line l="Ordinary tax cost (positive rental yrs, same for every Tax Profile)" v={-c.cumulativeTaxCost}/><Line l="Suspended losses released at sale" v={c.suspendedReleaseBenefit}/><Line l="Net sale proceeds" v={c.selectedNetSale}/><Line l="Total profit" v={c.totalProfit} strong/><Line l={roiLabel} v={c.headlineRoi} suffix="%" strong/><Line l="Pre-tax profit (no §469/sale tax effects — comparable to S&P)" v={c.pretaxProfit} strong/><Line l="Pre-tax ROI" v={c.pretaxRoi} suffix="%" strong/></div></section>
        <section className="panel market-section mobile-pane mobile-exit"><h2>Property + reserve IRR — pre-tax vs. after-tax</h2><div className="market-grid"><Card label="Initial investment" value={money(c.cashInvested)}/><Card label="Property net equity at exit (after-tax)" value={money(c.propertyExitEquity)}/><Card label="Cash + tax reserve (held, not invested)" value={money(c.reserve)}/><Card label="Combined exit value (after-tax)" value={money(c.combinedExitValue)}/><Card label="After-tax IRR / CAGR" value={percent(c.afterTaxIrr)} accent/></div><div className="market-grid pretax-row"><Card label="Property net equity at exit (pre-tax)" value={money(c.preTaxEquity)}/><Card label="Cash flow reserve (pre-tax, no §469 effects)" value={money(c.cumulativeCash)}/><Card label="Combined exit value (pre-tax)" value={money(c.pretaxCombinedExitValue)}/><Card label="Pre-tax IRR / CAGR" value={percent(c.pretaxIrr)} accent hint="Identical across all Tax Profiles and Exit Strategies — taxes only change timing/character of cash flow, never the underlying deal economics"/></div><p>Operating cash flow and each year's net tax effect are held at face value — no market reinvestment is assumed. This is why Combined exit value − Initial investment ({money(c.combinedExitValue-c.cashInvested)}) always exactly equals Total profit ({money(c.totalProfit)}) above, and why the after-tax IRR matches {roiLabel}.</p><p className="note-inline"><b>Use Pre-tax IRR ({percent(c.pretaxIrr)}) when comparing against a quoted S&P 500 / index return</b> — those benchmarks are almost always quoted pre-tax, so comparing them to an after-tax property IRR understates the property's relative performance. Use After-tax IRR ({percent(c.afterTaxIrr)}) when you want your actual take-home return net of §469 and capital-gains treatment.</p><div className="hypothetical-callout"><b>Optional comparison — not included in any total above</b><span>If instead you separately invested that same cash flow + tax reserve in the market at {percent(v.stockReturn)}/yr: hypothetical ending value {money(c.hypotheticalMarketExitValue)}, hypothetical IRR {percent(c.hypotheticalMarketIrr)}. Does not account for taxes on stock gains or dividends.</span></div></section>
        {v.exitStrategy==="1031"&&<section className="panel exchange-results mobile-pane mobile-exit"><h2>1031 exchange results</h2><div className="market-grid"><Card label="Cash out / boot after tax" value={money(c.netBootCash)}/><Card label="Equity rolled forward" value={money(c.preTaxEquity-c.boot)}/><Card label="Deferred tax liability" value={money(c.deferredTax)} warning/><Card label="Carryover basis" value={money(c.carryoverBasis)}/><Card label="New depreciable basis" value={money(c.replacementDepreciableBasis)}/><Card label="Annual depreciation" value={money(c.replacementAnnualDepreciation)}/><Card label="Ordinary tax cost during hold" value={money(c.cumulativeTaxCost)} warning hint="Years where NOI exceeded interest + depreciation still owe ordinary tax — same for every Tax Profile — this is unrelated to and not deferred by the exchange"/><Card label="Suspended losses carried to replacement" value={money(c.suspended)}/><Card label="Economic ROI" value={percent(c.headlineRoi)} accent/></div><p>1031 exchanges require a qualified intermediary, a 45-day identification window, and a 180-day closing window. This defers <b>sale-related</b> tax (recapture + capital gains)—it does not eliminate it, and it has no effect on annual ordinary-income tax owed in years the property throws off positive taxable rental income. Suspended passive losses remain carried forward, attached to the replacement property, until a future fully-taxable disposition.</p></section>}
      </div>
    </section>
    <nav className="mobile-tabbar" aria-label="Calculator sections">{([['inputs','Inputs'],['deal','Deal'],['projection','Projection'],['exit','Exit']] as [MobileTab,string][]).map(([tab,label])=><button key={tab} className={mobileTab===tab?"active":""} onClick={()=>openTab(tab)} aria-current={mobileTab===tab?"page":undefined}><span>{tab==='inputs'?'⌁':tab==='deal'?'◫':tab==='projection'?'↗':'◎'}</span>{label}</button>)}</nav>
  </main>;
}

function F({l,v,k,p,x,s}:{l:string,v:number,k:keyof typeof defaults,p?:string,x?:string,s:(k:keyof typeof defaults,x:string)=>void}){return <label className="field"><span>{l}</span><div>{p&&<i>{p}</i>}<input aria-label={l} type="number" value={v} onChange={e=>s(k,e.target.value)}/>{x&&<i>{x}</i>}</div></label>}
function Select({label,value,onChange,options}:{label:string,value:any,onChange:(x:any)=>void,options:any[][]}){return <label className="select-field"><span>{label}</span><select value={value} onChange={e=>onChange(typeof options[0][0]==="number"?Number(e.target.value):e.target.value)}>{options.map(([x,l])=><option key={x} value={x}>{l}</option>)}</select></label>}
function Kpi({label,value,sub,tone=""}:{label:string,value:string,sub:string,tone?:string}){return <div className={`kpi ${tone}`}><span>{label}</span><b>{value}</b><small>{sub}</small></div>}
function Line({l,v,strong,suffix}:{l:string,v:number,strong?:boolean,suffix?:string}){return <div className={`line ${strong?"strong":""}`}><span>{l}</span><b>{suffix?`${v.toFixed(1)}${suffix}`:money(v)}</b></div>}
function Card({label,value,accent,warning,hint}:{label:string,value:string,accent?:boolean,warning?:boolean,hint?:string}){return <div className={`result-card ${accent?"accent":""} ${warning?"warning-card":""}`}><span>{label}</span><b>{value}</b>{hint&&<small className="card-hint">{hint}</small>}</div>}
