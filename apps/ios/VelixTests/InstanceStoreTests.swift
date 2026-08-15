import XCTest
@testable import Velix

final class InstanceStoreTests: XCTestCase {
    func testAddSetsAsActiveWhenFirst() {
        let store = InstanceStore(keychain: KeychainStore(service: "com.velix.app.tests.instances"))
        store.clearAllForTesting()
        let instance = Instance(id: UUID(), baseURL: URL(string: "https://a.com")!, displayName: "a.com", userEmail: "a@a.com", accessToken: "tok")
        store.add(instance)
        XCTAssertEqual(store.activeInstance?.id, instance.id)
        XCTAssertEqual(store.instances.count, 1)
    }

    func testRemoveActiveFallsBackToAnother() {
        let store = InstanceStore(keychain: KeychainStore(service: "com.velix.app.tests.instances"))
        store.clearAllForTesting()
        let i1 = Instance(id: UUID(), baseURL: URL(string: "https://a.com")!, displayName: "a.com", userEmail: "a@a.com", accessToken: "t1")
        let i2 = Instance(id: UUID(), baseURL: URL(string: "https://b.com")!, displayName: "b.com", userEmail: "b@b.com", accessToken: "t2")
        store.add(i1)
        store.add(i2)
        store.setActive(i1)
        store.remove(i1)
        XCTAssertEqual(store.activeInstance?.id, i2.id)
    }

    func testRemoveLastLeavesNoActive() {
        let store = InstanceStore(keychain: KeychainStore(service: "com.velix.app.tests.instances"))
        store.clearAllForTesting()
        let i1 = Instance(id: UUID(), baseURL: URL(string: "https://a.com")!, displayName: "a.com", userEmail: "a@a.com", accessToken: "t1")
        store.add(i1)
        store.remove(i1)
        XCTAssertNil(store.activeInstance)
        XCTAssertTrue(store.instances.isEmpty)
    }
}
