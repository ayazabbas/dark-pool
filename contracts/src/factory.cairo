#[starknet::contract]
pub mod DarkPoolFactory {
    use starknet::{
        ContractAddress, ClassHash, get_caller_address, get_block_timestamp,
        syscalls::deploy_syscall,
    };
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        Map, StorageMapReadAccess, StorageMapWriteAccess,
    };

    // ─── Storage ────────────────────────────────────────────────────────

    #[storage]
    struct Storage {
        owner: ContractAddress,
        darkpool_class_hash: ClassHash,
        market_count: u64,
        markets: Map<u64, ContractAddress>,
    }

    // ─── Events ─────────────────────────────────────────────────────────

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        MarketCreated: MarketCreated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MarketCreated {
        #[key]
        pub market_id: u64,
        pub address: ContractAddress,
    }

    // ─── Constructor ────────────────────────────────────────────────────

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        darkpool_class_hash: ClassHash,
    ) {
        self.owner.write(owner);
        self.darkpool_class_hash.write(darkpool_class_hash);
        self.market_count.write(0);
    }

    // ─── External ───────────────────────────────────────────────────────

    #[abi(embed_v0)]
    impl FactoryImpl of crate::interfaces::IDarkPoolFactory<ContractState> {
        fn create_market(
            ref self: ContractState,
            bet_token: ContractAddress,
            fixed_escrow: u256,
            strike_price: i64,
            strike_price_expo: i32,
            commit_duration: u64,
            closed_duration: u64,
            reveal_duration: u64,
            fee_collector: ContractAddress,
        ) -> ContractAddress {
            let caller = get_caller_address();
            assert(caller == self.owner.read(), 'Only owner');

            let count = self.market_count.read();
            let market_id = count + 1;
            let start_time = get_block_timestamp();

            // Serialize DarkPool constructor args
            let mut calldata: Array<felt252> = array![];
            market_id.serialize(ref calldata);
            bet_token.serialize(ref calldata);
            fixed_escrow.serialize(ref calldata);
            strike_price.serialize(ref calldata);
            strike_price_expo.serialize(ref calldata);
            start_time.serialize(ref calldata);
            commit_duration.serialize(ref calldata);
            closed_duration.serialize(ref calldata);
            reveal_duration.serialize(ref calldata);
            // owner = this contract's owner (keeper can resolve/finalize)
            caller.serialize(ref calldata);
            fee_collector.serialize(ref calldata);

            // Deploy using felt252 of market_id as salt for unique addresses
            let salt: felt252 = market_id.into();
            let (deployed_address, _) = deploy_syscall(
                self.darkpool_class_hash.read(),
                salt,
                calldata.span(),
                false,
            )
                .unwrap();

            self.markets.write(market_id, deployed_address);
            self.market_count.write(market_id);

            self.emit(MarketCreated { market_id, address: deployed_address });

            deployed_address
        }

        fn get_market(self: @ContractState, market_id: u64) -> ContractAddress {
            self.markets.read(market_id)
        }

        fn get_market_count(self: @ContractState) -> u64 {
            self.market_count.read()
        }
    }
}
