# Vendored pipeline slice for Docker / CI

Runtime imports (`dictionaryLookupExclusion`, `vocabularyCorePolicy`) expect
`/lenra-content-pipeline/src/difficulty/constants.ts` in the container.

The full `lenra-content-pipeline` repo is not published to GitHub; this folder
is a minimal copy for deploy builds. After changing difficulty lexicons in the
pipeline repo, refresh:

```bash
cp ../lenra-content-pipeline/src/difficulty/constants.ts vendor/lenra-content-pipeline/src/difficulty/
cp ../lenra-content-pipeline/src/difficulty/lexicons/coreVocabulary.ts vendor/lenra-content-pipeline/src/difficulty/lexicons/
```
