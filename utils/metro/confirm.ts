import constants, { metroSequence } from '../../constants'
import { logger } from '../../shared/logger'
import { validateSchema, isObjectEmpty } from '..'
import { getValue, setValue } from '../../shared/dao'
import { validateContext } from './metroChecks'
import { validatePaymentTags } from './tags'
import { checkItemsExist, checkBilling } from './validate/helper'
import _, { isNil } from 'lodash'

export const checkConfirm = (data: any, msgIdSet: any) => {
  const errorObj: any = {}
  try {
    if (!data || isObjectEmpty(data)) {
      return { [metroSequence.CONFIRM]: 'Json cannot be empty' }
    }

    const { message, context }: any = data
    if (!message || !context || !message.order || isObjectEmpty(message) || isObjectEmpty(message.order)) {
      return { missingFields: '/context, /message, /order or /message/order is missing or empty' }
    }

    const schemaValidation = validateSchema('TRV', constants.CONFIRM, data)
    const contextRes: any = validateContext(context, msgIdSet, constants.ON_SEARCH, constants.CONFIRM)
    setValue(`${metroSequence.CONFIRM}_message`, message)

    if (schemaValidation !== 'error') {
      Object.assign(errorObj, schemaValidation)
    }

    if (!contextRes?.valid) {
      Object.assign(errorObj, contextRes.ERRORS)
    }

    const confirm = message.order

    const itemIDS: any = getValue('itemIds')
    const itemIdArray: any[] = []
    let newItemIDSValue: any[]

    if (itemIDS && itemIDS.length > 0) {
      newItemIDSValue = itemIDS
    } else {
      const onSelect: any = getValue(`${metroSequence.ON_SEARCH1}_message`)
      onSelect.order.items.map((item: { id: string }) => {
        itemIdArray.push(item.id)
      })
      newItemIDSValue = itemIdArray
    }

    setValue('itemIds', newItemIDSValue)

    try {
      logger.info(`Comparing Provider Id of /${constants.ON_SEARCH} and /${constants.CONFIRM}`)
      const prvrdID = getValue('providerId') //type should be an array instead of string
      const selectedProviderId = confirm?.provider?.id ?? null

      if (!isNil(selectedProviderId)) {
        if (isNil(prvrdID)) {
          logger.info(`Skipping Provider Id check due to insufficient data`)
          setValue('providerId', selectedProviderId ?? null)
        } else if (!prvrdID?.includes(confirm?.provider?.id)) {
          errorObj.prvdrId = `Provider Id for /${constants.ON_SEARCH} and /${constants.CONFIRM} api should be same`
        } else {
          setValue('providerId', selectedProviderId)
        }
      } else errorObj['providerId'] = 'Provider Id is missing in /' + constants.CONFIRM
    } catch (error: any) {
      logger.info(
        `Error while comparing provider id for /${constants.ON_SEARCH} and /${constants.CONFIRM} api, ${error.stack}`,
      )
    }

    //check items
    const getItemError = checkItemsExist(confirm, newItemIDSValue, 'CONFIRM')
    if (Object.keys(getItemError)?.length) Object.assign(errorObj, getItemError)

    try {
      logger.info(`Checking payments in /${constants.CONFIRM}`)
      confirm?.payments?.forEach((arr: any, i: number) => {
        if (!arr?.collected_by) {
          errorObj[`payemnts[${i}]_collected_by`] = `payments.collected_by must be present in ${constants.ON_SEARCH}`
        } else {
          const srchCollectBy = getValue(`collected_by`)
          if (srchCollectBy && srchCollectBy != arr?.collected_by)
            errorObj[`payemnts[${i}]_collected_by`] =
              `payments.collected_by value sent in ${constants.ON_SEARCH} should be ${srchCollectBy} as sent in ${constants.CONFIRM}`

          if (arr?.collected_by === 'BPP' && 'id' in arr)
            errorObj[`payemnts[${i}]_id`] = `id should not be present if collector is BPP`

          setValue(`collected_by`, arr?.collected_by)
        }

        const validTypes = ['PRE-ORDER', 'ON-FULFILLMENT', 'POST-FULFILLMENT']
        if (!arr?.type || !validTypes.includes(arr.type)) {
          errorObj[`payments[${i}]_type`] = `payments.params.type must be present in ${
            constants.CONFIRM
          } & its value must be one of: ${validTypes.join(', ')}`
        }

        const validStatus = ['NOT-PAID', 'PAID']
        if (!arr?.status || !validStatus.includes(arr.status)) {
          errorObj[`payments[${i}]_status`] = `payments.status must be present in ${
            constants.CONFIRM
          } & its value must be one of: ${validStatus.join(', ')}`
        }

        const params = arr.params
        if (!params?.bank_code) {
          errorObj[`payments[${i}]_bank_code`] = `payments.params.bank_code must be present in ${constants.CONFIRM}`
        } else {
          setValue('bank_code', params?.bank_code)
        }

        if (!params?.bank_account_number) {
          errorObj[`payments[${i}]_bank_account_number`] =
            `payments.params.bank_account_number must be present in ${constants.CONFIRM}`
        } else {
          setValue('bank_account_number', params?.bank_account_number)
        }

        if (!params?.virtual_payment_address) {
          errorObj[`payments[${i}]_virtual_payment_address`] =
            `payments.params.virtual_payment_address must be present in ${constants.CONFIRM}`
        } else {
          setValue('virtual_payment_address', params?.virtual_payment_address)
        }

        // Validate payment tags
        const tagsValidation = validatePaymentTags(arr.tags)
        if (!tagsValidation.isValid) {
          Object.assign(errorObj, { tags: tagsValidation.errors })
        }
      })
    } catch (error: any) {
      logger.error(`!!Errors while checking payments in /${constants.CONFIRM}, ${error.stack}`)
    }

    //check billing
    if (!isNil(confirm?.billing)) {
      const getBillingError = checkBilling(confirm?.billing, 'CONFIRM')
      if (Object.keys(getBillingError)?.length) Object.assign(errorObj, getBillingError)
    } else errorObj['billing'] = `billing object is missing in /${constants.CONFIRM}`

    return errorObj
  } catch (err: any) {
    logger.error(`!!Some error occurred while checking /${constants.CONFIRM} API`, err)
    return { error: err.message }
  }
}
