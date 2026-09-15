//go:build tools

// gomobile needs golang.org/x/mobile/bind to be a dependency of this module, and nothing here
// imports it — so `go mod tidy` drops it and the bind fails with "missing golang.org/x/mobile
// dependency". The blank import under a build tag that nothing builds is Go's own idiom for
// "a tool this module needs, not code it runs".

package obalkatransfer

import _ "golang.org/x/mobile/bind"
