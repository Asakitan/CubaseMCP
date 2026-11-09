#pragma once

#include <cstdint>

// Build-specific observations for Cubase AI 16.0.5, Windows x64.
// This is deliberately an incomplete ABI: the callback interface declaration,
// callback queryInterface IID, callback return types, and full threading contract
// have not been established. The approved diagnostic uses only the observed
// direct-call subset; this is not a production SDK contract.
namespace cubase_project_host_observed {

struct RequestCallback;

// Request-bearing host secondary interface, zero-based vtable slot 3.
// Mangled host symbol confirms int, reference-to-pointer, callback pointer,
// and reference-to-uint64_t. The immediate return reports submission only.
using RequestSlot = int (*)(void* host, const char* const& input,
                            RequestCallback* callback, std::uint64_t& request_id);

struct CallbackResultArgument {
    // Slot 4 receives a pointer to this one-field transient view. Both this
    // field and the referenced NUL-terminated bytes are borrowed for the call.
    const char* data;
};

// Machine-level direct-call subset only, not a declaration of the complete
// callback interface. The host call sites ignore all five return registers.
// Slot 0 is opaque here; no query-interface signature or IID is asserted.
struct DirectCallbackVtable {
    void (*opaque_slot0)();
    void (*retain)(RequestCallback*);
    void (*release)(RequestCallback*);
    void (*begin)(RequestCallback*, std::uint64_t);
    void (*result)(RequestCallback*, std::uint64_t, const char* const*);
    void (*error)(RequestCallback*, std::uint64_t);
};

} // namespace cubase_project_host_observed
