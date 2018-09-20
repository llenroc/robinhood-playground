const getFilesSortedByDate = require('../utils/get-files-sorted-by-date');
const recursiveUrl = require('../rh-actions/recursive-url');
const mapLimit = require('promise-map-limit');

const convertDateToRhFormat = date => {
    const [month, day, year] = date.split('-');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

const lookupInstrument = (() => {
    const instrumentCache = {};
    return async (Robinhood, instrument) => {
        if (instrumentCache[instrument]) {
            return instrumentCache[instrument];
        }
        const lookup = await Robinhood.url(instrument);
        instrumentCache[instrument] = lookup;
        return lookup;
    };
})();

const loadAllRobinhoodTransactions = async (Robinhood, daysBack = 1) => {

    startDate = (await getFilesSortedByDate('daily-transactions'))[daysBack - 1];
    console.log('loading all robinhood transactions since', startDate);
    const rhDate = convertDateToRhFormat(startDate);
    let orders = await Robinhood.orders({
        updated_at: rhDate,
    });
    orders = [
        ...orders.results,
        ...(orders.next ? await recursiveUrl(Robinhood, orders.next) : [])
    ];
    orders = orders
        .filter(t => t.state === 'filled')
        .filter(t => t.executions.length);

    console.log('looking up robinhood instruments');
    
    const withTickers = await mapLimit(orders, 1, async order => ({
        ...order,
        instrument: await lookupInstrument(Robinhood, order.instrument)
    }));

    console.log('done loading all robinhood transactions');
    return withTickers;
    // console.log({ orders });
};

module.exports = loadAllRobinhoodTransactions;