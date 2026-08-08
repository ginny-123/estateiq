# EstateIQ — App Functionality

## Purpose

EstateIQ is a configurable rental-property underwriting calculator. It estimates operating cash flow, debt service, equity creation, tax effects, return metrics, and exit profit over a selected holding period.

The app is an educational screening tool, not tax, legal, lending, or investment advice.

## User inputs

### Property and financing

- Property price
- Down payment percentage
- Mortgage interest rate
- Mortgage term in years
- Monthly rent
- Annual property taxes
- Annual home insurance
- Monthly HOA fees

### Operating assumptions

- Vacancy percentage
- Capital-reserve percentage of rent
- Maintenance percentage of rent
- Property-management percentage of rent

### Holding-period and exit assumptions

- Hold period in years
- Annual property-price appreciation
- Selling/agent cost percentage
- Building allocation percentage used for depreciation
- Depreciation recapture tax rate
- Capital-gains tax rate
- Marginal tax rate

### Tax profile

- Passive investor / no REPS
- Active participation
- REPS + material participation

The tax profile changes the modeled current tax-equivalent benefit. A real-estate license alone does not establish REPS.

## Core calculations

### Mortgage

The loan amount is calculated as:

```text
Property price × (1 − down payment percentage)
```

The monthly payment uses a standard fully amortizing fixed-rate mortgage formula. The first-year mortgage payment is separated into interest and principal.

### Operating income

```text
Annual rent = monthly rent × 12
Vacancy loss = annual rent × vacancy percentage
Operating expenses = property tax + insurance + HOA + reserves + maintenance + management
NOI = annual rent − vacancy loss − operating expenses
```

### Cash flow

```text
Annual cash flow = NOI − annual mortgage payment
                   − annual management expense
```

The monthly cash-flow bridge shows rent, vacancy, property tax, insurance, HOA, reserves, maintenance, management, NOI, and mortgage P&I.

### Cash-on-cash return

```text
Initial cash invested = down payment + estimated closing costs
Estimated closing costs = 2.5% of property price

Cash-on-cash return = annual cash flow ÷ initial cash invested
```

Cash-on-cash return measures spendable cash flow only. It does not include appreciation, principal paydown, or tax-equivalent benefits.

### Cap rate

```text
Cap rate = NOI ÷ property price
```

The app uses cap rate as an initial pricing screen.

### DSCR

```text
DSCR = NOI ÷ annual mortgage payment
```

A result around 1.20x or higher generally indicates more debt-service coverage, although lender standards vary.

## Return bridge

The app separates spendable cash from wealth creation:

```text
Monthly cash flow
+ monthly principal paydown
= cash + principal monthly return

+ allowed tax-equivalent benefit
= cash + principal + allowed tax equivalent
```

Principal paydown is not spendable cash. It reduces the loan balance and increases equity.

Tax-equivalent benefits are annual estimates divided by 12 for presentation. They are not guaranteed monthly payments.

## Tax calculations

### Depreciation

```text
Depreciable basis = property price × building allocation percentage
Annual depreciation = depreciable basis ÷ 27.5 years
```

### Taxable rental result

The model starts with rental income after operating expenses and mortgage interest, then applies depreciation:

```text
Taxable rental income before depreciation
− annual depreciation
= taxable rental result
```

Principal paydown is not deducted from taxable rental income.

### Passive investor profile

For the passive profile, the model estimates a current tax benefit only against positive taxable rental income:

```text
Currently usable depreciation = min(annual depreciation, positive taxable rental income)
Current passive tax benefit = usable deduction × marginal tax rate
Suspended passive loss = excess deduction not currently used
```

Suspended losses are excluded from current monthly return.

### Active participation profile

The app displays a partial modeled tax-equivalent benefit. This is only an estimate; actual eligibility and limits depend on income, participation, filing status, and other tax rules.

### REPS profile

The app displays a larger potential benefit based on mortgage interest plus depreciation. This assumes the user qualifies as a real-estate professional and materially participates. It is not a guarantee of deductibility.

## Year-by-year projection

For each year in the selected hold period, the app shows:

- Projected property value using annual appreciation
- Remaining mortgage balance
- Principal paid during the year
- Annual cash flow
- Allowed annual tax-equivalent benefit

## Sale and total profit

At the end of the hold period, the app estimates:

```text
Sale price = original price × (1 + appreciation rate) ^ hold period
Adjusted basis = original price − accumulated depreciation
Net sale proceeds = sale price − remaining loan − selling costs − sale taxes
```

Sale taxes are estimated using two buckets:

- Depreciation-related recapture
- Remaining capital gain

Total profit is modeled as:

```text
Net sale proceeds
− initial cash invested
+ cumulative annual cash flow
+ cumulative allowed tax-equivalent benefit
```

## Recommendation logic

The current screening recommendation uses three thresholds:

- Cap rate: at least 5.5%
- Cash-on-cash return: at least 6%
- DSCR: at least 1.20x

If all three are met, the app shows “Strong candidate.” If cash-on-cash return is at least 3%, it shows “Needs negotiation.” Otherwise it shows “Pass for now.”

These are screening thresholds and should not be treated as an automatic buy or sell decision.

## Data handling

- Inputs are held in the browser’s React state.
- The calculator does not require a database or external property-data feed.
- No user account or property-sharing workflow is currently implemented.
- The model uses only the values entered by the user and the built-in assumptions.

## Known limitations

- Closing costs are currently estimated at 2.5% of purchase price.
- Rent growth, expense inflation, refinancing, repairs by year, and changing tax brackets are not modeled separately.
- Tax treatment is simplified and does not replace professional tax preparation.
- State and local taxes, depreciation conventions, land allocation, passive-loss phaseouts, NIIT, and filing-status effects are not fully modeled.
- Sale-tax calculations are estimates and should be validated before relying on them.
