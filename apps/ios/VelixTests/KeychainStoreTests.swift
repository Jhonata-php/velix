import XCTest
@testable import Velix

final class KeychainStoreTests: XCTestCase {
    let store = KeychainStore(service: "com.velix.app.tests")

    override func tearDown() {
        store.delete(forKey: "test-key")
        super.tearDown()
    }

    func testSaveAndRead() throws {
        let data = "segredo".data(using: .utf8)!
        store.save(data, forKey: "test-key")
        XCTAssertEqual(store.read(forKey: "test-key"), data)
    }

    func testReadMissingKeyReturnsNil() {
        XCTAssertNil(store.read(forKey: "nunca-existiu"))
    }

    func testDeleteRemoves() throws {
        store.save("x".data(using: .utf8)!, forKey: "test-key")
        store.delete(forKey: "test-key")
        XCTAssertNil(store.read(forKey: "test-key"))
    }

    func testOverwriteReplacesValue() throws {
        store.save("primeiro".data(using: .utf8)!, forKey: "test-key")
        store.save("segundo".data(using: .utf8)!, forKey: "test-key")
        XCTAssertEqual(store.read(forKey: "test-key"), "segundo".data(using: .utf8)!)
    }
}
