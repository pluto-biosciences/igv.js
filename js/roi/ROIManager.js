import Picker from '../../node_modules/vanilla-picker/dist/vanilla-picker.mjs'
import {DOMUtils} from "../../node_modules/igv-utils/src/index.js"
import ROI, {GLOBAL_ROI_TYPE, ROI_DEFAULT_COLOR, ROI_HEADER_DEFAULT_COLOR, screenCoordinates} from './ROI.js'
import ROIMenu from "./ROIMenu.js"

class ROIManager {
    constructor(browser, roiTable, top, roiList) {

        this.browser = browser
        this.roiTable = roiTable
        this.top = top
        this.roiList = roiList || []
        this.monitorBrowserEvents()
    }

    monitorBrowserEvents() {
        this.browser.on('locuschange',       () => paint(this.browser, this.top, this.roiList))
        this.browser.on('trackremoved',      () => paint(this.browser, this.top, this.roiList))
        this.browser.on('trackorderchanged', () => paint(this.browser, this.top, this.roiList))
    }

    addROI(region) {

        const config =
            {
                name: `region-${DOMUtils.guid()}`,
                menu: new ROIMenu(this.browser.columnContainer),
                featureSource:
                    {
                        getFeatures :(chr, start, end) => [ region ]
                    },
                color: ROI_HEADER_DEFAULT_COLOR
            }


        this.roiList.push(new ROI(config, this.browser.genome, GLOBAL_ROI_TYPE))

        paint(this.browser, this.top, this.roiList)
    }

}

async function paint(browser, top, roiList) {

    const columns = browser.columnContainer.querySelectorAll('.igv-column')

    for (let i = 0; i < columns.length; i++) {

        clearGlobalROIDOMElement(columns[i])

        const { chr, start:startBP, end:endBP, bpPerPixel:bpp } = browser.referenceFrameList[ i ]

        for (let roi of roiList) {

            const regions = await roi.getFeatures(chr, startBP, endBP)

            if (regions && regions.length > 0) {

                for (let { start:regionStartBP, end:regionEndBP } of regions) {

                    if (regionEndBP < startBP) {
                        continue
                    }

                    if (regionStartBP > endBP) {
                        break
                    }

                    regionStartBP = Math.max(regionStartBP, startBP)
                    regionEndBP = Math.min(regionEndBP, endBP)
                    columns[ i ].appendChild(createGlobalROIDOMElement(browser.columnContainer, top, roi, regionStartBP, regionEndBP, startBP, bpp))
                }
            }

        }

    }

}

function clearGlobalROIDOMElement(column) {
    const regionElements = column.querySelectorAll('.igv-roi')
    for (let i = 0; i < regionElements.length; i++) {
        regionElements[ i ].remove()
    }
}

function createGlobalROIDOMElement(columnContainer, top, roi, regionStartBP, regionEndBP, startBP, bpp) {

    const { x:regionX, width:regionWidth } = screenCoordinates(regionStartBP, regionEndBP, startBP, bpp)

    // ROI container
    const container = DOMUtils.div({class: 'igv-roi'})
    container.style.top = `${top}px`
    container.style.left = `${regionX}px`
    container.style.width = `${regionWidth}px`
    // container.style.backgroundColor = roi.color
    container.style.backgroundColor = ROI_DEFAULT_COLOR

    // header
    const header = DOMUtils.div()
    header.style.backgroundColor = roi.color
    container.appendChild(header)

    // Color and Alpha Picker
    // const pickerConfig =
    //     {
    //         parent: header,
    //         popup: 'right',
    //         editorFormat: 'rgb',
    //         editor:false,
    //         color: header.style.backgroundColor,
    //         onChange: ({rgbaString}) => {
    //             header.style.backgroundColor = roi.color = rgbaString
    //         }
    //     }
    //
    // new Picker(pickerConfig)

    header.addEventListener('click', event => {

        const {x, y} = DOMUtils.translateMouseCoordinates(event, columnContainer)
        console.log(`event.target.parentElement x ${ x } y ${ y }`)
        roi.menu.present(x, y)
    })

    return container
}

export default ROIManager
