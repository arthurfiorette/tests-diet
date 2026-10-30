# Examples

Generalized from a production monorepo audit. Bad examples show the code they get in reports; good examples show which bar questions they pass.

## Bad

### `CONST`: a constant compared with its own literal

```ts
it('uses the default page size', () => {
  expect(DEFAULT_PAGE_SIZE).toBe(50);
});

it('builds the prompt with the guard rails', () => {
  const prompt = buildCreatePrompt({ name: 'Quiz' });
  expect(prompt).toContain('Never create a second quiz');
  expect(prompt).toContain('Answer in the user language');
});

it('renders with default styling classes', () => {
  render(<Card data-testid="card" />);
  const card = screen.getByTestId('card');
  expect(card).toHaveClass('rounded-xl');
  expect(card).toHaveClass('border');
  expect(card).toHaveClass('bg-bg-primary');
  expect(card).toHaveClass('shadow-sm');
});
```

Each test copies a literal from the code. Changing the literal on purpose only means changing the test the same way, and nothing else makes it fail: it catches no bug, it just doubles every edit.

### `TYPE`: what the compiler already checks

```ts
it('exposes the field components', () => {
  expect(typeof Form.Field).toBe('function');
  expect(typeof Form.Label).toBe('function');
});

it('creates a record', async () => {
  const row = await service.create(ownerId, input);
  expect(row.id).toBeDefined();
  expect(row.createdAt).toBeInstanceOf(Date);
});
```

### `TAUT`: the expected value comes from the implementation

```python
def test_price_with_tax():
    subtotal, rate = 84.99, 0.0825
    assert price_with_tax(subtotal, region="TX") == round(subtotal * (1 + rate), 2)
```

```ts
it('allows the configured origins', () => {
  const pattern = new RegExp(`^https://(.+\\.)?${escape(DOMAIN)}$`); // copied from production
  expect(pattern.test('https://app.example.com')).toBe(true);
});
```

### `CALLS`: only internal call shape

```ts
vi.mock('./claim.js');
vi.mock('./runs.js');

it('queues the sync', async () => {
  await enqueueSync(accountId);
  expect(claim).toHaveBeenCalledWith(accountId);
  expect(startRun).toHaveBeenCalledTimes(1);
});
```

### `NOOP`: the title promises what the body never does

```tsx
it('calls onCreate when the user creates an option', () => {
  const onCreate = vi.fn();
  render(<Combobox onCreate={onCreate} />);
  expect(onCreate).not.toHaveBeenCalled(); // never triggered
});

it('filters by status', async () => {
  const { count } = await service.list(ownerId, { status: 'ACTIVE' });
  expect(count).toBeGreaterThanOrEqual(0);
});
```

### `TRIVIAL` and `LIB`

```tsx
it('renders very long text', () => {
  render(<Card title={'a'.repeat(500)} />);
  expect(screen.getByText('a'.repeat(500))).toBeInTheDocument();
});

it('toggles with Space', async () => {
  render(<Switch />); // thin wrapper over a UI toolkit primitive
  await user.keyboard(' ');
  expect(screen.getByRole('switch')).toBeChecked();
});
```

### `SOURCE`, `SNAP` and `LAYER`

```ts
it('every page pairs light and dark classes', () => {
  for (const file of glob.sync('src/**/*.tsx')) {
    expect(readFileSync(file, 'utf8')).not.toMatch(/bg-white(?! dark:)/); // a lint rule, not a test
  }
});

it('compiles the status filter', () => {
  expect(compile({ field: 'status', op: 'eq', value: 'open' })).toMatchSnapshot(); // locks the whole IR
});
```

```python
def test_create_order_route(mocker):
    mocker.patch("orders.repo.insert", return_value=Order(id=1))  # the database is the behavior
    assert client.post("/orders", json=payload).status_code == 201
```

### `DUP`: one file per variant, or a step covered by a flow

```text
conditions/equals.test.ts       28 lines of setup, one boolean assertion
conditions/not-equals.test.ts   same setup, one boolean assertion
conditions/contains.test.ts     same setup, one boolean assertion
... 17 more
```

One table-driven test over operators with a shared fixture covers all of them.

```text
e2e/create-tag.spec.ts            creates a tag, sees a toast
e2e/rename-and-delete-tag.spec.ts creates a tag, renames it, reloads, deletes it
```

The first is a strict subset of the second.

```ts
describe('updateCampaign', () => {
  it('saves the subject', ...);
  it('null clears the subject', ...);
  it('omitted keeps the subject', ...);
  it('saves the preheader', ...);
  it('null clears the preheader', ...);
  it('omitted keeps the preheader', ...);
  // ...the same three for every new column
});
```

The three cases test the update helper, not the columns. One table over the columns covers them, and passthrough columns need no case at all.

```ts
it('getCampaign rejects another owner', ...);
it('getCampaign returns not found for a deleted campaign', ...);
it('updateCampaign rejects another owner', ...);
it('updateCampaign returns not found for a deleted campaign', ...);
it('deleteCampaign rejects another owner', ...);
// ...the same pair for every method
```

Isolation is costly, so it needs a test, but one table over the service's methods proves it once.

### `FLAKY` and `DEAD`

```python
def test_job_does_not_send_twice(queue):
    queue.enqueue(job)
    time.sleep(1.5)            # passes even when the code is broken
    assert sent_messages() == 1
```

```rust
#[test]
#[ignore] // broken since the storage migration
fn legacy_import_keeps_order() { /* ... */ }
```

### `LOW_VALUE`: correct but not worth its cost

```ts
describe('businessTodayIso', () => {
  it('uses the business time zone, not the browser one', () => {
    expect(businessTodayIso(new Date('2026-08-07T15:30:00Z'))).toBe('2026-08-07');
  });
  // ...6 more cases around midnight and month boundaries
});
```

A wrong date on a display screen is visible and cheap to fix, and another test already runs through the helper.

## Good

### Concurrency with an exact outcome (costly, silent, likely)

```ts
it('four parallel assignments pick four different attendants', async () => {
  const picks = await Promise.all([1, 2, 3, 4].map(() => distribution.assign(teamId)));
  expect(new Set(picks).size).toBe(4);
});
```

### Tenant isolation as one table (costly, silent, cheap)

```ts
it.each(byIdRoutes)('%s answers 404 for another owner and leaves the rows alone', async (route) => {
  const response = await app.inject({ ...route, headers: authAs(otherOwner) });
  expect(response.statusCode).toBe(404);
  expect(await countRows(owner)).toBe(before);
});
```

### Money through the real database, only the gateway stubbed (costly, silent, likely)

```python
def test_partial_refund_keeps_sale_paid(db, gateway):
    sale = make_sale(db, amount_cents=10_000)
    gateway.refund.return_value = Refund(id="r1", amount_cents=2_500)
    refund(db, sale.id, amount_cents=2_500)
    assert db.get(Sale, sale.id).status == "PAID"
    assert db.get(Sale, sale.id).refunded_cents == 2_500
```

### Adversarial input for a security guard (costly, silent, likely)

```rust
#[test]
fn rejects_redirect_to_private_address() {
    let client = SafeClient::new(resolver_returning(&["10.0.0.5"]));
    assert!(matches!(client.get("https://public.example/redirect"), Err(Error::PrivateAddress)));
}
```

### Invariant instead of magic numbers (silent, likely, cheap)

```ts
it('per-column totals equal the sum of the cells', () => {
  const table = aggregate(rows);
  for (const column of table.columns) {
    expect(column.total).toBe(column.cells.reduce((a, b) => a + b, 0));
  }
});
```
