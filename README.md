# Mina zkApp: Eth-processor

## How to build

```sh
npm run build
```

## How to run

Replace the nodeVk.json, p0.json and sp1Proof.json in src/proofs with your sp1 proof and proof conversion output and run `npm run prove-and-submit`.

## How to run tests

```sh
npm run test # all tests
npm run test -- -t "should perform a series of proof submissions" # run a specific test
npm run testw # watch mode
```

Interest observation if run more than one test (thus creating more than one instance) it seems to hang.

## How to run coverage

```sh
npm run coverage
```

## License

[Apache-2.0](LICENSE)
