import { logger } from '../../shared/logger'
import { setValue } from '../../shared/dao'
import constants, { intercitySequence } from '../../constants'
import { validateSchema, isObjectEmpty, checkMetroContext } from '..'
import { trvDomains } from '../../constants/trv'
import { validatePaymentTags } from '../metro/tags'

export const search = (data: any, msgIdSet: any) => {
  logger.info('Starting search validation')
  const errorObj: any = {}

  try {
    const structureErrors = validateBasicStructure(data)
    if (Object.keys(structureErrors).length) {
      logger.warn('Basic structure validation failed')
      return structureErrors
    }

    logger.debug('Validating schema and context')
    const schemaValidation = validateSchema(data.context.domain.split(':')[1], constants.SEARCH, data)
    const contextRes: any = checkMetroContext(data.context, constants.SEARCH)

    setValue(`${intercitySequence.SEARCH}_context`, data.context)
    msgIdSet.add(data.context.message_id)

    if (schemaValidation !== 'error') {
      logger.debug('Schema validation errors found')
      Object.assign(errorObj, schemaValidation)
    }
    if (!contextRes?.valid) {
      logger.debug('Context validation errors found')
      Object.assign(errorObj, contextRes.ERRORS)
    }

    Object.assign(errorObj, validateContext(data.context))

    if (data.message.intent?.fulfillment) {
      logger.debug('Validating fulfillment details')
      const fulfillment = data.message.intent.fulfillment
      const stopsErrors = validateStops(fulfillment.stops)
      const vehicleErrors = validateVehicle(fulfillment.vehicle)

      if (stopsErrors.length) errorObj.stops = stopsErrors
      if (vehicleErrors.length) errorObj.vehicle = vehicleErrors
    }

    try {
      logger.info(`Validating payments object for /${constants.SEARCH}`)
      const paymentErrors = validatePayment(data.message.intent?.payment)
      Object.assign(errorObj, paymentErrors)
    } catch (error: any) {
      logger.error(`Payment validation error in /${constants.SEARCH}:`, error.message)
    }

    logger.info('Search validation completed')
    return Object.keys(errorObj).length > 0 && errorObj
  } catch (error: any) {
    logger.error('Search validation failed with error:', error.message)
    return { error: error.message }
  }
}

const validateContext = (context: any) => {
  logger.info('Starting context validation')
  const errors: any = {}

  if (!context?.location?.city?.code) {
    logger.warn('City code missing in context')
    errors.city = `City code must be present context`
  }

  if (context?.location?.country?.code !== 'IND') {
    logger.warn('Invalid country code found:', context?.location?.country?.code)
    errors.city = `Country code must be IND`
  }

  logger.info('Context validation completed')
  return errors
}

export const validateStops = (stops: any[]) => {
  logger.info('Starting stops validation')
  const errors: string[] = []

  if (!stops || stops.length === 0) {
    logger.warn('Stops array is empty or missing')
    errors.push('Fulfillment stops are missing or empty.')
    return errors
  }

  const stopTypes = stops.map((stop) => stop.type)
  const invalidStopTypes = stopTypes.filter((type) => type !== 'START' && type !== 'END')

  if (invalidStopTypes.length > 0) {
    logger.warn('Invalid stop types detected:', invalidStopTypes)
    errors.push(
      `Invalid stop types found: ${invalidStopTypes.join(', ')}. Fulfillment stops must contain only 'START' and 'END' types.`,
    )
  }

  stops.forEach((stop, index) => {
    logger.debug(`Validating stop ${index + 1}`)
    if (stop.location && typeof stop.location.gps === 'string') {
      const gpsPattern = /^\d{1,2}\.\d{1,6}, \d{1,3}\.\d{1,6}$/
      if (!gpsPattern.test(stop.location.gps)) {
        logger.warn(`Invalid GPS format in stop ${index + 1}:`, stop.location.gps)
        errors.push(`Invalid GPS format in stop ${index + 1}. It should be in the format 'latitude, longitude'.`)
      }
    } else {
      logger.warn(`Missing or invalid GPS in stop ${index + 1}`)
      errors.push(`GPS is missing or invalid in stop ${index + 1}.`)
    }
  })

  logger.info('Stops validation completed')
  return errors
}

export const validateVehicle = (vehicle: any) => {
  logger.info('Starting vehicle validation')
  const errors: string[] = []

  if (!vehicle) {
    logger.warn('Vehicle information missing')
    errors.push('Vehicle information is missing.')
    return errors
  }

  if (!vehicle.category) {
    logger.warn('Vehicle category missing')
    errors.push('Vehicle category is missing.')
  } else if (!['BUS', 'AIRLINE'].includes(vehicle.category)) {
    logger.warn('Invalid vehicle category:', vehicle.category)
    errors.push(`Invalid vehicle category. It must be one of 'BUS' or 'AIRLINE'.`)
  }

  if (vehicle.variant && !['AC', 'NON-AC'].includes(vehicle.variant)) {
    logger.warn('Invalid vehicle variant:', vehicle.variant)
    errors.push(`Invalid vehicle variant. It must be one of 'AC' or 'NON-AC'.`)
  }

  if (vehicle.capacity && (!Number.isInteger(vehicle.capacity) || vehicle.capacity <= 0)) {
    logger.warn('Invalid vehicle capacity:', vehicle.capacity)
    errors.push('Vehicle capacity must be a positive integer.')
  }

  if (vehicle.energy_type) {
    const validEnergyTypes = ['DIESEL', 'ELECTRIC', 'PETRO', 'HYDROGEN', 'BIOFUELS', 'CNG', 'LPG']
    if (!validEnergyTypes.includes(vehicle.energy_type)) {
      logger.warn('Invalid energy type:', vehicle.energy_type)
      errors.push(`Invalid vehicle energy_type. It must be one of ${validEnergyTypes.join(', ')}.`)
    }
  }

  logger.info('Vehicle validation completed')
  return errors
}

const validateBasicStructure = (data: any) => {
  logger.info('Starting basic structure validation')
  const errors: any = {}

  if (!data || isObjectEmpty(data)) {
    logger.warn('Empty JSON data received')
    errors[intercitySequence.SEARCH] = 'Json cannot be empty'
    return errors
  }

  if (
    !data.message ||
    !data.context ||
    !data.message.intent ||
    isObjectEmpty(data.message) ||
    isObjectEmpty(data.message.intent)
  ) {
    logger.warn('Missing required fields in data structure')
    errors['missingFields'] = '/context, /message, /intent or /message/intent is missing or empty'
  }

  if (!trvDomains.includes(data.context.domain)) {
    logger.warn('Invalid domain in context:', data.context.domain)
    errors[intercitySequence.SEARCH] = 'Json cannot be empty'
  }

  logger.info('Basic structure validation completed')
  return errors
}

const validatePayment = (payment: any) => {
  logger.info('Starting payment validation')
  const errors: any = {}
  const collectedBy = payment?.collected_by

  if (!collectedBy) {
    logger.warn('Missing collected_by in payment')
    errors['collected_by'] = `collected_by must be present in payment object`
  } else if (collectedBy !== 'BPP' && collectedBy !== 'BAP') {
    logger.warn('Invalid collected_by value:', collectedBy)
    errors['collected_by'] = `payment.collected_by can only be either 'BPP' or 'BAP' in ${intercitySequence.SEARCH}`
  } else {
    logger.debug('Setting collected_by value:', collectedBy)
    setValue(`collected_by`, collectedBy)
  }

  const tagsValidation = validatePaymentTags(payment.tags)
  if (!tagsValidation.isValid) {
    logger.warn('Payment tags validation failed:', tagsValidation.errors)
    errors.tags = tagsValidation.errors
  }

  logger.info('Payment validation completed')
  return errors
}
